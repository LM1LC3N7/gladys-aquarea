// -----------------------------------------------------------------------------
// One heat pump, whatever the transport, as a "snapshot", and the Gladys
// device built from it (pure).
//
// Both sources (src/cloud/status.js, src/heishamon/state.js) describe the
// heat pump the same way, values in °C, W and Hz, `null` for a value the
// source knows but has not got now, a field left out when the source never
// reports it (the cloud has no inlet temperature, HeishaMon no daily
// consumption):
//
//   { platformId, name, model,
//     power: 0|1, mode: THERMOSTAT_MODE, cooling: bool, operatingState,
//     zones: [{ id, temperature, waterSensor, heat: { target, min, max, shift },
//               cool: { target, min, max, shift } | null }],
//     tank: { temperature, target, min, max, heating } | null,
//     outdoor, inlet, outlet, compressor, heatPower, consumedPower,
//     quiet, powerful, defrost, error: { code, message } }
//
// Feature external ids `<device>:<key>` are forever: the keys below never
// change (a feature leaves the list when the heat pump stops reporting it,
// never under another key).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  NO_ERROR,
  POWERFUL_LEVELS,
  QUIET_LEVELS,
  THERMOSTAT_MODE,
  THERMOSTAT_OPERATING_STATE,
} from './constants.js';
import { tankTop } from './config.js';
import { names } from './i18n.js';

/** The keys whose commands the sources implement. */
export const WRITABLE = new Set([
  'binary',
  'mode',
  'zone1-heat-setpoint',
  'zone1-cool-setpoint',
  'zone2-heat-setpoint',
  'zone2-cool-setpoint',
  'tank-setpoint',
  'quiet-mode',
]);

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const has = (value) => value !== undefined;

/** A number state, or nothing to send. */
const num = (value) => (isNumber(value) ? { state: value } : null);
const text = (value) => (value === null || value === undefined ? null : { text: String(value) });

/** The modes a heat pump offers in Gladys (no cooling without the cooling kit). */
export function supportedModes(snapshot) {
  const modes = [THERMOSTAT_MODE.OFF, THERMOSTAT_MODE.HEATING];
  if (snapshot.cooling) {
    modes.push(THERMOSTAT_MODE.COOLING);
  }
  modes.push(THERMOSTAT_MODE.AUTO);
  return modes;
}

/**
 * The features of a heat pump: `[{ key, feature, read, throttle }]`, where
 * `feature` is the Gladys feature without its external id and `read`
 * extracts its state from a snapshot (`{ state }`, `{ text }` or null).
 * @param {object} snapshot
 * @param {'en'|'fr'} language
 */
export function featureSpecs(snapshot, language = 'en', { tankCap } = {}) {
  const n = names(language);
  const specs = [];
  const add = (key, feature, read, { throttle = false } = {}) => {
    const writable = WRITABLE.has(key);
    specs.push({
      key,
      feature: {
        name: feature.name,
        category: feature.category,
        type: feature.type,
        ...(feature.unit ? { unit: feature.unit } : {}),
        min: feature.min ?? 0,
        max: feature.max ?? 1,
        ...(feature.step ? { step: feature.step } : {}),
        read_only: !writable,
        has_feedback: writable,
        keep_history: feature.history ?? true,
        ...(feature.options ? { supported_options: feature.options } : {}),
      },
      read,
      throttle,
    });
  };
  const temperature = (key, name, type, pick, { min = -50, max = 100 } = {}) =>
    add(
      key,
      { name, category: CAT.TEMPERATURE_SENSOR, type, unit: UNITS.CELSIUS, min, max },
      (s) => num(pick(s)),
      { throttle: true },
    );

  if (has(snapshot.power)) {
    add('binary', { name: n.binary, category: CAT.SWITCH, type: TYPES.SWITCH.BINARY }, (s) =>
      num(s.power),
    );
  }
  if (has(snapshot.mode)) {
    add(
      'mode',
      {
        name: n.mode,
        category: CAT.THERMOSTAT,
        type: TYPES.THERMOSTAT.MODE,
        max: THERMOSTAT_MODE.AUTO,
        options: supportedModes(snapshot).map((value) => ({ value, label: n.modes[value] })),
      },
      (s) => num(s.mode),
    );
  }
  if (has(snapshot.operatingState)) {
    add(
      'operating-state',
      {
        name: n.operatingState,
        category: CAT.THERMOSTAT,
        type: TYPES.THERMOSTAT.OPERATING_STATE,
        max: THERMOSTAT_OPERATING_STATE.COOLING,
      },
      (s) => num(s.operatingState),
    );
  }
  for (const zone of snapshot.zones ?? []) {
    const id = zone.id;
    const at = (s) => (s.zones ?? []).find((z) => z.id === id);
    if (has(zone.temperature)) {
      // A zone regulated on its water temperature reports the water, not the
      // room: a probe, kept out of the room average.
      temperature(
        `zone${id}-temperature`,
        n.zoneTemperature(id),
        zone.waterSensor ? TYPES.TEMPERATURE_SENSOR.PROBE : TYPES.SENSOR.DECIMAL,
        (s) => at(s)?.temperature,
      );
    }
    for (const kind of ['heat', 'cool']) {
      const range = zone[kind];
      if (!range) {
        continue;
      }
      add(
        `zone${id}-${kind}-setpoint`,
        {
          name: n.setpoint(id, kind, range.shift),
          category: CAT.THERMOSTAT,
          type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
          unit: UNITS.CELSIUS,
          min: range.min,
          max: range.max,
          step: 1,
        },
        (s) => num(at(s)?.[kind]?.target),
      );
    }
  }
  if (snapshot.tank) {
    const { tank } = snapshot;
    if (has(tank.temperature)) {
      temperature('tank-temperature', n.tankTemperature, TYPES.TEMPERATURE_SENSOR.PROBE, (s) =>
        s.tank ? s.tank.temperature : null,
      );
    }
    if (has(tank.target)) {
      add(
        'tank-setpoint',
        {
          name: n.tankSetpoint,
          category: CAT.WATER_HEATER,
          type: TYPES.WATER_HEATER.TARGET_TEMPERATURE,
          unit: UNITS.CELSIUS,
          min: tank.min,
          // Never above the ceiling (65 °C at most), nor the heat pump's limit.
          max: tankTop(tank.max, tankCap),
          step: 1,
        },
        (s) => num(s.tank?.target),
      );
    }
    if (has(tank.heating)) {
      add(
        'tank-heating',
        { name: n.tankHeating, category: CAT.WATER_HEATER, type: TYPES.WATER_HEATER.HEATING },
        (s) => num(s.tank?.heating),
      );
    }
  }
  if (has(snapshot.outdoor)) {
    temperature('outdoor-temperature', n.outdoor, TYPES.TEMPERATURE_SENSOR.PROBE, (s) => s.outdoor);
  }
  if (has(snapshot.inlet)) {
    temperature('inlet-temperature', n.inlet, TYPES.TEMPERATURE_SENSOR.PROBE, (s) => s.inlet);
  }
  if (has(snapshot.outlet)) {
    temperature('outlet-temperature', n.outlet, TYPES.TEMPERATURE_SENSOR.PROBE, (s) => s.outlet);
  }
  if (has(snapshot.compressor)) {
    // Gladys has no hertz: the unit is in the name.
    add(
      'compressor-frequency',
      { name: n.compressor, category: CAT.UNKNOWN, type: TYPES.UNKNOWN.UNKNOWN, max: 250 },
      (s) => num(s.compressor),
      { throttle: true },
    );
  }
  if (has(snapshot.consumedPower)) {
    add(
      'power-consumed',
      {
        name: n.consumedPower,
        category: CAT.ENERGY_SENSOR,
        type: TYPES.ENERGY_SENSOR.POWER,
        unit: UNITS.WATT,
        max: 30_000,
      },
      (s) => num(s.consumedPower),
      { throttle: true },
    );
    // Integrated by the app (src/energy.js): the index of the energy dashboards.
    add(
      'energy-consumed',
      {
        name: n.consumedEnergy,
        category: CAT.ENERGY_SENSOR,
        type: TYPES.ENERGY_SENSOR.ENERGY,
        unit: UNITS.KILOWATT_HOUR,
        max: 10_000_000,
      },
      (s) => num(s.consumedEnergy),
      { throttle: true },
    );
  }
  if (has(snapshot.heatPower)) {
    // Thermal power: not electricity, so not an energy-sensor feature (the
    // energy dashboards and contracts would count it as a consumption).
    add(
      'heat-produced',
      {
        name: n.heatPower,
        category: CAT.UNKNOWN,
        type: TYPES.UNKNOWN.UNKNOWN,
        unit: UNITS.WATT,
        max: 50_000,
      },
      (s) => num(s.heatPower),
      { throttle: true },
    );
  }
  if (snapshot.dailyConsumption) {
    // Fed with publishEnergyConsumption (dated days), never with states.
    add(
      'daily-consumption',
      {
        name: n.dailyConsumption,
        category: CAT.ENERGY_SENSOR,
        type: TYPES.ENERGY_SENSOR.DAILY_CONSUMPTION,
        unit: UNITS.KILOWATT_HOUR,
        max: 1000,
      },
      () => null,
    );
  }
  if (has(snapshot.quiet)) {
    add(
      'quiet-mode',
      {
        name: n.quiet,
        category: CAT.TEXT,
        type: TYPES.TEXT.SELECT,
        max: 3,
        history: false,
        options: QUIET_LEVELS.map((value) => ({ value, label: n.quietLevels[value] })),
      },
      (s) => (isNumber(s.quiet) ? text(s.quiet) : null),
    );
  }
  if (has(snapshot.powerful)) {
    add(
      'powerful-mode',
      {
        name: n.powerful,
        category: CAT.TEXT,
        type: TYPES.TEXT.SELECT,
        max: 3,
        history: false,
        options: POWERFUL_LEVELS.map((value) => ({ value, label: n.powerfulLevels[value] })),
      },
      (s) => (isNumber(s.powerful) ? text(s.powerful) : null),
    );
  }
  if (has(snapshot.defrost)) {
    add('defrost', { name: n.defrost, category: CAT.SWITCH, type: TYPES.SWITCH.BINARY }, (s) =>
      num(s.defrost),
    );
  }
  if (has(snapshot.error)) {
    add(
      'error',
      { name: n.error, category: CAT.TEXT, type: TYPES.TEXT.TEXT, history: false },
      (s) => (s.error ? text(s.error.code ?? NO_ERROR) : null),
    );
  }
  return specs;
}

const paramsOf = (snapshot, source) =>
  [
    { name: 'AQUAREA_SOURCE', value: source },
    { name: 'AQUAREA_MODEL', value: snapshot.model },
    { name: 'AQUAREA_ID', value: snapshot.platformId },
  ]
    .filter((p) => p.value !== undefined && p.value !== null && String(p.value) !== '')
    .map((p) => ({ name: p.name, value: String(p.value).slice(0, 255) }));

/**
 * The Gladys device of a snapshot, and its readers.
 * @param {{ device: string, feature: (key: string) => string }} ids
 * @param {object} snapshot
 * @param {{ language: 'en'|'fr', source: 'cloud'|'heishamon' }} ctx
 */
export function buildDevice(ids, snapshot, { language, source, tankCap }) {
  const specs = featureSpecs(snapshot, language, { tankCap });
  return {
    device: {
      name: String(snapshot.name || names(language).device).slice(0, 100),
      external_id: ids.device,
      should_poll: false,
      params: paramsOf(snapshot, source),
      features: specs.map(({ key, feature }) => ({ ...feature, external_id: ids.feature(key) })),
    },
    readers: specs.map(({ key, read, throttle }) => ({
      key,
      featureId: ids.feature(key),
      read,
      throttle,
    })),
  };
}

/** The states of a snapshot: `[{ featureId, value }]` for the values known now. */
export function statesOf(readers, snapshot) {
  const states = [];
  for (const { featureId, read } of readers) {
    const value = read(snapshot);
    if (value) {
      states.push({ featureId, value });
    }
  }
  return states;
}
