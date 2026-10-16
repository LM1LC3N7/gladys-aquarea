// -----------------------------------------------------------------------------
// The Aquarea calls of the Panasonic cloud, on a PanasonicSession.
//
// The heat pumps are listed with the air conditioners (/device/group,
// deviceType "2"); their status, commands and consumption go through the
// /remote/v1/app/common/transfer proxy, which forwards `apiName` to the
// Aquarea service (aioaquarea 1.0.7 device_manager.py, device_control.py,
// consumption_manager.py; aio-panasonic-comfort-cloud apiclient/_aquarea.py).
//
// `deviceDirect=1` asks the adapter (CZ-TAW1) for a live status, slower and
// failing when the adapter is offline; `deviceDirect=0` returns what the
// cloud kept. The proxy answers HTTP 200 with a `message` list when the
// Aquarea service refused the request (adapter offline, value refused).
// -----------------------------------------------------------------------------

import {
  AQUAREA_DEVICE_TYPE,
  CONSUMPTION_API,
  CONSUMPTION_MONTH,
  DEVICES_API,
  TRANSFER_PATH,
} from './constants.js';
import { PanasonicError } from './http.js';

const pad = (number) => String(number).padStart(2, '0');

/** "+02:00": the local UTC offset at `date`, as osTimezone. */
export function utcOffset(date = new Date()) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "20261015": a local date, as the consumption API writes it. */
export function compactDate(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/**
 * The refusal an Aquarea answer carries in its `message` list (HTTP 200), or
 * null. Only the code and a short message are kept.
 */
export function aquareaRefusal(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return null;
  }
  const list = Array.isArray(answer.message) ? answer.message : [answer.message];
  for (const item of list) {
    if (item && typeof item === 'object' && (item.errorCode || item.errorMessage)) {
      const code = String(item.errorCode ?? '').slice(0, 40);
      const text = String(item.errorMessage ?? '').slice(0, 160);
      // "Token expires": the session needs renewing, like an HTTP 401.
      const expired = /token expire/i.test(text);
      return new PanasonicError(`Aquarea refused the request${code ? ` (${code})` : ''}: ${text}`, {
        kind: expired ? 'http' : 'device',
        status: expired ? 401 : undefined,
        code,
      });
    }
  }
  return null;
}

/** The Aquarea heat pumps of the account: `[{ guid, name, model }]`. */
export function parseDevices(groups) {
  const found = [];
  for (const group of groups?.groupList ?? []) {
    const list = group?.deviceList ?? group?.deviceIdList ?? [];
    for (const device of Array.isArray(list) ? list : []) {
      if (!device || String(device.deviceType) !== AQUAREA_DEVICE_TYPE || !device.deviceGuid) {
        continue;
      }
      if (found.some((d) => d.guid === device.deviceGuid)) {
        continue;
      }
      found.push({
        guid: String(device.deviceGuid),
        name: String(device.deviceName ?? '').trim(),
        model: String(device.deviceModuleNumber ?? '').trim(),
      });
    }
  }
  return found;
}

export class AquareaApi {
  /** @param {import('./session.js').PanasonicSession} session */
  constructor(session, { now = () => Date.now() } = {}) {
    this.session = session;
    this.now = now;
  }

  async transfer(payload, step) {
    let answer = await this.session.call('POST', TRANSFER_PATH, payload, step);
    let refusal = aquareaRefusal(answer);
    if (refusal?.status === 401) {
      // The Aquarea service said the token expired: a new one, once.
      this.session.session.accessToken = null;
      answer = await this.session.call('POST', TRANSFER_PATH, payload, step);
      refusal = aquareaRefusal(answer);
    }
    if (refusal) {
      throw refusal;
    }
    return answer;
  }

  /** The heat pumps of the account. */
  async devices() {
    return parseDevices(await this.session.call('GET', '/device/group', undefined, 'device list'));
  }

  /**
   * The status of a heat pump: `{ status: {...}, a2wName, ... }`.
   * @param {string} guid
   * @param {{ live: boolean }} options live: asked to the adapter, else the cloud copy
   */
  status(guid, { live }) {
    return this.transfer(
      {
        apiName: `${DEVICES_API}?gwid=${encodeURIComponent(guid)}&deviceDirect=${live ? 1 : 0}`,
        requestMethod: 'GET',
      },
      'status',
    );
  }

  /** A change of the heat pump: only the given fields of `bodyParam`. */
  control(guid, body) {
    return this.transfer(
      { apiName: DEVICES_API, requestMethod: 'POST', bodyParam: { gwid: guid, ...body } },
      'command',
    );
  }

  /**
   * The consumption per day of the month of `date` (`historyDataList`, one
   * entry per day, `dataTime` "YYYYMMDD").
   */
  consumption(guid, date = new Date(this.now())) {
    return this.transfer(
      {
        apiName: CONSUMPTION_API,
        requestMethod: 'POST',
        bodyParam: {
          gwid: guid,
          dataMode: CONSUMPTION_MONTH,
          date: compactDate(date),
          osTimezone: utcOffset(date),
        },
      },
      'consumption',
    );
  }
}
