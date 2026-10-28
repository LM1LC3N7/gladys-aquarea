// -----------------------------------------------------------------------------
// The Aquarea status as a snapshot (src/model.js), the command bodies, and
// the consumption per day (pure).
//
// Field names and values as aioaquarea 1.0.7 (device_manager.py, data.py)
// and aio-panasonic-comfort-cloud (models/aquarea.py, constants.py) read
// them: operationStatus, operationMode (0 off, 1 heat, 2 cool, 3 auto heat,
// 4 auto cool), deiceStatus (sic: defrost), direction (0 idle, 1 room,
// 2 water), outdoorNow, quietMode, powerful, faultStatus, tankStatus and
// zoneStatus with temperatureNow / heatSet / heatMin / heatMax / coolSet /
// coolMin / coolMax.
//
// Commands: sockless-coding found that `zoneStatus` and `tankStatus` are
// replaced, not merged: a mode or on/off change resends the on/off status
// of every zone and of the tank, or the omitted ones reset (the tank
// switching itself back on, zones that never turn off).
// -----------------------------------------------------------------------------

import { tankTop } from '../config.js';
import { DHW_CAP, THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE } from '../constants.js';
import {
  DIRECTION,
  INVALID_TEMPERATURE,
  NO_CONSUMPTION,
  OPERATION_STATUS,
  STATUS_MODE,
  UPDATE_MODE,
} from './constants.js';
import { PanasonicError } from './http.js';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value) => {
  if (isNumber(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};
/** A temperature, or null when the unit has none (126, or a sentinel below -100). */
const temperature = (value) => {
  const t = number(value);
  return t === null || t === INVALID_TEMPERATURE || t <= -100 ? null : t;
};
const flag = (value) => {
  const n = number(value);
  return n === 1 ? 1 : n === 0 ? 0 : null;
};
const level = (value, max = 3) => {
  const n = number(value);
  return n !== null && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

/** The status object of an answer (an object, or a list of one in older answers). */
export function statusOf(answer) {
  const raw = Array.isArray(answer?.status) ? answer.status[0] : answer?.status;
  if (!raw || typeof raw !== 'object') {
    throw new PanasonicError('status: no status in the answer', { kind: 'protocol' });
  }
  return raw;
}

const zonesOf = (raw) =>
  (Array.isArray(raw.zoneStatus) ? raw.zoneStatus : []).filter(
    (z) => z && typeof z === 'object' && [1, 2].includes(number(z.zoneId)),
  );

/** A setpoint range of a zone, or null when the zone has no such setpoint. */
function rangeOf(zone, kind, fallback) {
  const target = number(zone[`${kind}Set`]);
  const min = number(zone[`${kind}Min`]);
  const max = number(zone[`${kind}Max`]);
  if (target === null && min === null && max === null) {
    return null;
  }
  const low = min ?? fallback.min;
  const high = max !== null && max > low ? max : Math.max(low + 1, fallback.max);
  return {
    target,
    min: low,
    max: high,
    // A compensation curve: the setpoint is a shift of -5 to +5 °C.
    shift: low >= -5 && high <= 5,
  };
}

/** The room mode of Gladys: off when the unit is off, or when it only makes hot water. */
function roomMode(power, mode, zones) {
  if (power !== 1) {
    return power === 0 ? THERMOSTAT_MODE.OFF : null;
  }
  if (zones.length > 0 && zones.every((z) => number(z.operationStatus) !== OPERATION_STATUS.ON)) {
    return THERMOSTAT_MODE.OFF;
  }
  switch (mode) {
    case STATUS_MODE.HEAT:
      return THERMOSTAT_MODE.HEATING;
    case STATUS_MODE.COOL:
      return THERMOSTAT_MODE.COOLING;
    case STATUS_MODE.AUTO_HEAT:
    case STATUS_MODE.AUTO_COOL:
      return THERMOSTAT_MODE.AUTO;
    case STATUS_MODE.OFF:
      return THERMOSTAT_MODE.OFF;
    default:
      return null;
  }
}

/**
 * A snapshot of one heat pump from its status answer.
 * @param {object} answer the answer of AquareaApi.status
 * @param {{ guid: string, name?: string, model?: string }} device
 */
export function parseStatus(answer, device) {
  const raw = statusOf(answer);
  const power = flag(raw.operationStatus);
  const mode = number(raw.operationMode);
  const zones = zonesOf(raw);
  const direction = number(raw.direction);
  const cooling =
    number(raw.coolMode) === 1 ||
    zones.some((z) => number(z.coolMin) !== null && number(z.coolMax) !== null);
  const tankRaw =
    raw.tankStatus && typeof raw.tankStatus === 'object' && Object.keys(raw.tankStatus).length > 0
      ? raw.tankStatus
      : null;

  let operatingState = THERMOSTAT_OPERATING_STATE.IDLE;
  if (power === 1 && direction === DIRECTION.ROOM) {
    if (mode === STATUS_MODE.COOL || mode === STATUS_MODE.AUTO_COOL) {
      operatingState = THERMOSTAT_OPERATING_STATE.COOLING;
    } else if (mode === STATUS_MODE.HEAT || mode === STATUS_MODE.AUTO_HEAT) {
      operatingState = THERMOSTAT_OPERATING_STATE.HEATING;
    }
  }

  const tankOn = tankRaw ? number(tankRaw.operationStatus) === OPERATION_STATUS.ON : false;
  const fault = (Array.isArray(raw.faultStatus) ? raw.faultStatus : []).find(
    (f) => f && typeof f === 'object' && (f.errorCode || f.errorMessage),
  );

  return {
    platformId: device.guid,
    name: String(answer?.a2wName || device.name || '').trim(),
    model: device.model || undefined,
    power,
    mode: roomMode(power, mode, zones),
    cooling,
    operatingState,
    zones: zones
      .map((z) => ({
        id: number(z.zoneId),
        temperature: temperature(z.temperatureNow),
        waterSensor: false,
        heat: rangeOf(z, 'heat', { min: 20, max: 55 }),
        cool: cooling ? rangeOf(z, 'cool', { min: 5, max: 20 }) : null,
      }))
      .sort((a, b) => a.id - b.id),
    tank: tankRaw
      ? {
          temperature: temperature(tankRaw.temperatureNow),
          target: number(tankRaw.heatSet),
          min: number(tankRaw.heatMin) ?? 40,
          max: number(tankRaw.heatMax) ?? 65,
          heating: power === 1 && tankOn && direction === DIRECTION.WATER ? 1 : 0,
        }
      : null,
    outdoor: temperature(raw.outdoorNow),
    quiet: level(raw.quietMode),
    powerful: level(raw.powerful ?? raw.powerfulRequest),
    defrost: flag(raw.deiceStatus) ?? 0,
    error: fault
      ? {
          code: String(fault.errorCode || 'error').slice(0, 40),
          message: String(fault.errorMessage ?? '').slice(0, 200),
        }
      : { code: null },
    dailyConsumption: true,
  };
}

const round = (value, { min, max } = {}) => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new PanasonicError(`not a number: ${value}`, { kind: 'protocol' });
  }
  let r = Math.round(n);
  if (min !== undefined) {
    r = Math.max(min, r);
  }
  if (max !== undefined) {
    r = Math.min(max, r);
  }
  return r;
};

const UPDATE_OF = {
  [THERMOSTAT_MODE.OFF]: UPDATE_MODE.OFF,
  [THERMOSTAT_MODE.HEATING]: UPDATE_MODE.HEAT,
  [THERMOSTAT_MODE.COOLING]: UPDATE_MODE.COOL,
  [THERMOSTAT_MODE.AUTO]: UPDATE_MODE.AUTO,
};

/**
 * The `bodyParam` of a Gladys command (without `gwid`).
 * @param {string} key the feature key (src/model.js)
 * @param {number|string} value the Gladys value
 * @param {object} raw the last status object of the heat pump (statusOf)
 * @param {{ tankCap?: number }} [options] the hot water ceiling of the
 *   configuration (65 °C by default, never above 65 °C, see tankTop)
 */
export function commandBody(key, value, raw, { tankCap } = {}) {
  const zones = zonesOf(raw ?? {});
  const tankRaw = raw?.tankStatus && Object.keys(raw.tankStatus).length > 0 ? raw.tankStatus : null;
  const tankStatus = number(tankRaw?.operationStatus) === OPERATION_STATUS.ON ? 1 : 0;
  const statuses = (status) =>
    zones.map((z) => ({
      zoneId: number(z.zoneId),
      operationStatus: status ?? (number(z.operationStatus) === OPERATION_STATUS.ON ? 1 : 0),
    }));

  const setpoint = /^zone([12])-(heat|cool)-setpoint$/.exec(key);
  if (setpoint) {
    const zone = zones.find((z) => number(z.zoneId) === Number(setpoint[1]));
    const kind = setpoint[2];
    const bounds = {
      min: number(zone?.[`${kind}Min`]) ?? undefined,
      max: number(zone?.[`${kind}Max`]) ?? undefined,
    };
    return {
      zoneStatus: [{ zoneId: Number(setpoint[1]), [`${kind}Set`]: round(value, bounds) }],
    };
  }

  switch (key) {
    case 'binary': {
      const on = round(value) === 1 ? 1 : 0;
      let zoneStatus = statuses();
      // Turning on a unit whose zones and tank are all off would do nothing.
      if (on && tankStatus === 0 && zoneStatus.every((z) => z.operationStatus === 0)) {
        zoneStatus = statuses(1);
      }
      return { operationStatus: on, zoneStatus, tankStatus: { operationStatus: tankStatus } };
    }
    case 'mode': {
      const mode = round(value);
      if (!(mode in UPDATE_OF)) {
        throw new PanasonicError(`unknown mode ${value}`, { kind: 'protocol' });
      }
      if (mode === THERMOSTAT_MODE.OFF) {
        // Room heating off; the hot water keeps running if it was on.
        return {
          operationMode: UPDATE_MODE.OFF,
          operationStatus: tankStatus,
          zoneStatus: statuses(0),
          tankStatus: { operationStatus: tankStatus },
        };
      }
      return {
        operationMode: UPDATE_OF[mode],
        operationStatus: 1,
        zoneStatus: statuses(1),
        tankStatus: { operationStatus: tankStatus },
      };
    }
    case 'tank-setpoint': {
      // The heat pump's own range, under the ceiling (65 °C at most): a lower
      // limit of the heat pump wins, an unknown one leaves the ceiling.
      const min = number(tankRaw?.heatMin) ?? undefined;
      const top = tankTop(number(tankRaw?.heatMax), tankCap);
      if (min !== undefined && min > top) {
        throw new PanasonicError(`no hot water setpoint fits under ${top} °C`, {
          kind: 'protocol',
        });
      }
      const heatSet = round(value, { min, max: top });
      // Last check before the value leaves, whatever computed it.
      if (!(heatSet <= top && heatSet <= DHW_CAP.max)) {
        throw new PanasonicError(`hot water setpoint ${heatSet} °C above the ceiling`, {
          kind: 'protocol',
        });
      }
      return { tankStatus: { heatSet } };
    }
    case 'quiet-mode':
      return { quietMode: round(value, { min: 0, max: 3 }) };
    default:
      throw new PanasonicError(`${key} cannot be controlled`, { kind: 'protocol' });
  }
}

/** "2026-10-14" from "20261014", or null. */
const isoDate = (compact) => {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(compact ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const kwhOf = (value) => {
  const n = number(value);
  return n === null || n === NO_CONSUMPTION || n < 0 ? null : n;
};

/**
 * The finished days of a consumption answer: `[{ date: 'YYYY-MM-DD', kwh }]`,
 * heating, cooling and hot water added; the days before `today` only.
 * @param {object} answer the answer of AquareaApi.consumption
 * @param {string} today "YYYY-MM-DD", the local date of now
 */
export function parseConsumption(answer, today) {
  const days = [];
  for (const item of Array.isArray(answer?.historyDataList) ? answer.historyDataList : []) {
    const date = isoDate(item?.dataTime);
    if (!date || date >= today) {
      continue;
    }
    const parts = [item.heatConsumption, item.coolConsumption, item.tankConsumption].map(kwhOf);
    if (parts.every((p) => p === null)) {
      continue;
    }
    const kwh = parts.reduce((sum, p) => sum + (p ?? 0), 0);
    days.push({ date, kwh: Math.round(kwh * 1000) / 1000 });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}
