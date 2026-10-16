// -----------------------------------------------------------------------------
// One HeishaMon (one heat pump): the values of its topics, the snapshot
// (src/model.js) built from them, and the commands of a Gladys value (pure).
//
// HeishaMon publishes every value under `<base>/main/<Name>` (retained, as
// text: "21.5", "1", "H62"), the more precise power values of the newer heat
// pumps under `<base>/extra/<Name>`, and Online/Offline under `<base>/LWT`.
// It takes commands on `<base>/commands/<SetName>`, or through its web
// server at `/command?<SetName>=<value>`. The names and values below come
// from its documentation (Egyras/HeishaMon MQTT-Topics.md, read as
// documentation only: the repository carries no licence).
// -----------------------------------------------------------------------------

import { THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE } from '../constants.js';

/** Topics carried as text, not numbers. */
const TEXT_TOPICS = new Set(['Error', 'Heat_Pump_Model']);

/** State topics where -1 means "unknown" (HeishaMon's own convention). */
const STATE_TOPICS = new Set([
  'Heatpump_State',
  'Operating_Mode_State',
  'Defrosting_State',
  'Quiet_Mode_Level',
  'Powerful_Mode_Time',
  'ThreeWay_Valve_State',
  'Zones_State',
  'Heating_Mode',
  'Cooling_Mode',
  'DHW_Installed',
  'Z1_Sensor_Settings',
  'Z2_Sensor_Settings',
]);

/** Operating_Mode_State: what the room does, and whether hot water is part of it. */
const OPERATING_MODES = {
  0: { room: THERMOSTAT_MODE.HEATING, dhw: false }, // Heat only
  1: { room: THERMOSTAT_MODE.COOLING, dhw: false }, // Cool only
  2: { room: THERMOSTAT_MODE.AUTO, dhw: false, cooling: false }, // Auto (heat)
  3: { room: THERMOSTAT_MODE.OFF, dhw: true }, // DHW only
  4: { room: THERMOSTAT_MODE.HEATING, dhw: true }, // Heat + DHW
  5: { room: THERMOSTAT_MODE.COOLING, dhw: true }, // Cool + DHW
  6: { room: THERMOSTAT_MODE.AUTO, dhw: true, cooling: false }, // Auto (heat) + DHW
  7: { room: THERMOSTAT_MODE.AUTO, dhw: false, cooling: true }, // Auto (cool)
  8: { room: THERMOSTAT_MODE.AUTO, dhw: true, cooling: true }, // Auto (cool) + DHW
};

/** SetOperationMode values. */
const SET_MODE = {
  [THERMOSTAT_MODE.HEATING]: { plain: 0, dhw: 4 },
  [THERMOSTAT_MODE.COOLING]: { plain: 1, dhw: 5 },
  [THERMOSTAT_MODE.AUTO]: { plain: 2, dhw: 6 },
};
const DHW_ONLY = 3;

/** A zone's setpoint: a shift of the heating curve (-5 to +5), or a water temperature. */
const SETPOINT_RANGES = {
  heat: { shift: { min: -5, max: 5 }, direct: { min: 20, max: 65 } },
  cool: { shift: { min: -5, max: 5 }, direct: { min: 5, max: 20 } },
};

/** The value of a payload: a number, a text, or null (unknown). */
export function parseValue(name, payload) {
  const text = String(payload ?? '').trim();
  if (TEXT_TOPICS.has(name)) {
    return text === '' ? null : text.slice(0, 200);
  }
  if (text === '') {
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return null;
  }
  if (STATE_TOPICS.has(name) && value < 0) {
    return null;
  }
  return value;
}

export class HeishamonState {
  /**
   * @param {string} platformId the base topic, or the board address (HTTP)
   */
  constructor(platformId) {
    this.platformId = platformId;
    /** name -> value of `main/<name>` */
    this.main = new Map();
    /** name -> value of `extra/<name>` */
    this.extra = new Map();
    /** 'Online' | 'Offline' | undefined */
    this.lwt = undefined;
    this.lastAt = undefined;
  }

  /**
   * A value received. Returns true when it changed.
   * @param {'main'|'extra'} group
   */
  apply(group, name, payload, at) {
    const map = group === 'extra' ? this.extra : this.main;
    const value = parseValue(name, payload);
    this.lastAt = at;
    const changed = map.get(name) !== value || !map.has(name);
    map.set(name, value);
    return changed;
  }

  get ready() {
    return this.main.has('Heatpump_State') && this.main.has('Operating_Mode_State');
  }

  /** The sum of the values of some topics of one group, null when none is known. */
  sum(group, names) {
    const map = group === 'extra' ? this.extra : this.main;
    const values = names.map((n) => map.get(n)).filter((v) => typeof v === 'number');
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  }

  /**
   * The power values: the extra block when the heat pump sends one (the main
   * ones are then invalid, -200 and the like), the main topics otherwise.
   */
  powers() {
    const hasExtra = this.extra.size > 0;
    const consumed = hasExtra
      ? this.sum('extra', [
          'Heat_Power_Consumption_Extra',
          'Cool_Power_Consumption_Extra',
          'DHW_Power_Consumption_Extra',
        ])
      : this.sum('main', [
          'Heat_Power_Consumption',
          'Cool_Power_Consumption',
          'DHW_Power_Consumption',
        ]);
    const produced = hasExtra
      ? this.sum('extra', [
          'Heat_Power_Production_Extra',
          'Cool_Power_Production_Extra',
          'DHW_Power_Production_Extra',
        ])
      : this.sum('main', [
          'Heat_Power_Production',
          'Cool_Power_Production',
          'DHW_Power_Production',
        ]);
    const valid = (w) => (w === null ? null : w < 0 ? null : w);
    return { consumed: valid(consumed), produced: valid(produced) };
  }

  /** The snapshot of the heat pump (src/model.js). */
  snapshot() {
    const m = (name) => this.main.get(name);
    const known = (name) => this.main.has(name);
    const num = (name) => (typeof m(name) === 'number' ? m(name) : null);
    const field = (name) => (known(name) ? num(name) : undefined);

    const power = num('Heatpump_State');
    const op = OPERATING_MODES[num('Operating_Mode_State')];
    const compressor = num('Compressor_Freq');
    const valveDhw = num('ThreeWay_Valve_State') === 1;
    const running = power === 1 && compressor !== null && compressor > 0;

    let mode = null;
    if (power === 0) {
      mode = THERMOSTAT_MODE.OFF;
    } else if (power === 1 && op) {
      mode = op.room;
    }

    let operatingState = THERMOSTAT_OPERATING_STATE.IDLE;
    if (running && !valveDhw && op) {
      const cooling = op.room === THERMOSTAT_MODE.COOLING || op.cooling === true;
      if (op.room !== THERMOSTAT_MODE.OFF) {
        operatingState = cooling
          ? THERMOSTAT_OPERATING_STATE.COOLING
          : THERMOSTAT_OPERATING_STATE.HEATING;
      }
    }

    // Zones_State: 0 zone 1, 1 zone 2, 2 both. Zone 1 is always there.
    const zonesState = num('Zones_State');
    const zoneIds = zonesState === 1 || zonesState === 2 ? [1, 2] : [1];
    const zones = zoneIds.map((id) => {
      const sensor = num(`Z${id}_Sensor_Settings`);
      const heatShift = num('Heating_Mode') !== 1; // 0 = compensation curve, 1 = direct
      const coolShift = num('Cooling_Mode') !== 1;
      const range = (kind, shift) => ({
        target: num(`Z${id}_${kind === 'heat' ? 'Heat' : 'Cool'}_Request_Temp`),
        ...SETPOINT_RANGES[kind][shift ? 'shift' : 'direct'],
        shift,
      });
      return {
        id,
        temperature: field(`Z${id}_Temp`),
        // 0 = water temperature: the zone reads its water, not a room.
        waterSensor: sensor === 0,
        heat: known(`Z${id}_Heat_Request_Temp`) ? range('heat', heatShift) : null,
        cool: known(`Z${id}_Cool_Request_Temp`) ? range('cool', coolShift) : null,
      };
    });

    // DHW_Installed when published, else a tank temperature is enough.
    const tankInstalled = known('DHW_Installed') ? num('DHW_Installed') === 1 : known('DHW_Temp');
    const tank = tankInstalled
      ? {
          temperature: field('DHW_Temp'),
          target: field('DHW_Target_Temp'),
          min: 40,
          max: 75,
          heating: known('Compressor_Freq') ? (running && valveDhw ? 1 : 0) : undefined,
        }
      : null;

    const errorText = m('Error');
    const { consumed, produced } = this.powers();
    const hasPower =
      this.extra.size > 0 || known('Heat_Power_Consumption') || known('DHW_Power_Consumption');

    return {
      platformId: this.platformId,
      name: undefined,
      model: typeof m('Heat_Pump_Model') === 'string' ? m('Heat_Pump_Model') : undefined,
      power: field('Heatpump_State'),
      mode: known('Heatpump_State') ? mode : undefined,
      // Every heat pump HeishaMon knows is a "C" (heat and cool) model; on a
      // unit whose cooling is not enabled, the heat pump ignores the commands.
      cooling: true,
      operatingState: known('Compressor_Freq') ? operatingState : undefined,
      zones,
      tank,
      outdoor: field('Outside_Temp'),
      inlet: field('Main_Inlet_Temp'),
      outlet: field('Main_Outlet_Temp'),
      compressor: field('Compressor_Freq'),
      consumedPower: hasPower ? consumed : undefined,
      heatPower: hasPower ? produced : undefined,
      quiet: field('Quiet_Mode_Level'),
      powerful: field('Powerful_Mode_Time'),
      defrost: field('Defrosting_State'),
      error: known('Error')
        ? { code: isError(errorText) ? errorText : null, message: errorText ?? '' }
        : undefined,
    };
  }

  /**
   * The HeishaMon commands of a Gladys value: `[{ name, value }]`, sent as
   * `<base>/commands/<name>` (MQTT) or `/command?<name>=<value>` (HTTP).
   */
  commands(key, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`not a number: ${value}`);
    }
    const int = Math.round(n);
    const setpoint = /^zone([12])-(heat|cool)-setpoint$/.exec(key);
    if (setpoint) {
      const [, id, kind] = setpoint;
      const shift = this.main.get(kind === 'heat' ? 'Heating_Mode' : 'Cooling_Mode') !== 1;
      const { min, max } = SETPOINT_RANGES[kind][shift ? 'shift' : 'direct'];
      return [
        {
          name: `SetZ${id}${kind === 'heat' ? 'Heat' : 'Cool'}RequestTemperature`,
          value: Math.max(min, Math.min(max, int)),
        },
      ];
    }
    switch (key) {
      case 'binary':
        return [{ name: 'SetHeatpump', value: int === 1 ? 1 : 0 }];
      case 'mode':
        return this.modeCommands(int);
      case 'tank-setpoint':
        return [{ name: 'SetDHWTemp', value: Math.max(40, Math.min(75, int)) }];
      case 'quiet-mode':
        return [{ name: 'SetQuietMode', value: Math.max(0, Math.min(3, int)) }];
      default:
        throw new Error(`${key} cannot be controlled`);
    }
  }

  /**
   * A thermostat mode. Off stops the room only: a heat pump that makes hot
   * water keeps doing it (DHW only), one that does not is switched off. Any
   * other mode keeps the hot water as it was, and switches the pump on.
   */
  modeCommands(mode) {
    const power = this.main.get('Heatpump_State');
    const op = OPERATING_MODES[this.main.get('Operating_Mode_State')];
    const dhw = op ? op.dhw : this.main.get('DHW_Installed') === 1;
    if (mode === THERMOSTAT_MODE.OFF) {
      if (power === 0) {
        return [];
      }
      return dhw
        ? [{ name: 'SetOperationMode', value: DHW_ONLY }]
        : [{ name: 'SetHeatpump', value: 0 }];
    }
    const set = SET_MODE[mode];
    if (!set) {
      throw new Error(`unknown mode ${mode}`);
    }
    const commands = [{ name: 'SetOperationMode', value: dhw ? set.dhw : set.plain }];
    if (power !== 1) {
      commands.push({ name: 'SetHeatpump', value: 1 });
    }
    return commands;
  }
}

/** "H62", "F12" (HeishaMon prints the number in hex): an error code; "No error" is none. */
export const isError = (text) => typeof text === 'string' && /^[HF][0-9A-F]{2}$/i.test(text.trim());
