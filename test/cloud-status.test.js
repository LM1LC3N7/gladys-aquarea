// -----------------------------------------------------------------------------
// The Aquarea answers as snapshots, the command bodies, the consumption days.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aquareaRefusal, compactDate, parseDevices, utcOffset } from '../src/cloud/api.js';
import { commandBody, parseConsumption, parseStatus, statusOf } from '../src/cloud/status.js';
import { THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE } from '../src/constants.js';
import * as fx from './fixtures/cloud.js';

const DEVICE = { guid: fx.GUID, name: 'PAC maison', model: 'WH-MDC09J3E5' };

test('the device list keeps the Aquarea heat pumps only', () => {
  assert.deepEqual(parseDevices(fx.groups), [
    { guid: fx.GUID, name: 'PAC maison', model: 'WH-MDC09J3E5' },
  ]);
  assert.deepEqual(parseDevices({}), []);
  const idList = { groupList: [{ deviceIdList: [{ deviceGuid: 'g', deviceType: 2 }] }] };
  assert.equal(parseDevices(idList)[0].guid, 'g', 'deviceIdList, numeric deviceType');
});

test('a refusal in a 200 answer is an error; "Token expires" asks for a new token', () => {
  const offline = aquareaRefusal(fx.refusalOffline);
  assert.equal(offline.kind, 'device');
  assert.match(offline.message, /Device is offline/);
  const expired = aquareaRefusal({
    message: [{ errorCode: '4100', errorMessage: 'Token expires' }],
  });
  assert.equal(expired.status, 401);
  assert.equal(aquareaRefusal(fx.statusTwoZones()), null);
  assert.equal(aquareaRefusal({}), null);
});

test('the dates of the consumption request', () => {
  const date = new Date(2026, 9, 5, 12);
  assert.equal(compactDate(date), '20261005');
  assert.match(utcOffset(date), /^[+-]\d{2}:\d{2}$/);
});

test('two zones, curve and direct, cooling, a tank: the snapshot', () => {
  const s = parseStatus(fx.statusTwoZones(), DEVICE);
  assert.equal(s.platformId, fx.GUID);
  assert.equal(s.name, 'PAC maison');
  assert.equal(s.model, 'WH-MDC09J3E5');
  assert.equal(s.power, 1);
  assert.equal(s.mode, THERMOSTAT_MODE.HEATING);
  assert.equal(s.operatingState, THERMOSTAT_OPERATING_STATE.HEATING);
  assert.equal(s.cooling, true);
  assert.equal(s.outdoor, 7);
  assert.equal(s.quiet, 2);
  assert.equal(s.powerful, 0);
  assert.equal(s.defrost, 0);
  assert.deepEqual(s.error, { code: null });
  assert.equal(s.dailyConsumption, true);
  assert.deepEqual(s.zones[0], {
    id: 1,
    temperature: 21,
    waterSensor: false,
    heat: { target: 2, min: -5, max: 5, shift: true },
    cool: { target: 0, min: -5, max: 5, shift: true },
  });
  assert.deepEqual(s.zones[1].heat, { target: 38, min: 20, max: 55, shift: false });
  assert.deepEqual(s.zones[1].cool, { target: 18, min: 5, max: 20, shift: false });
  assert.deepEqual(s.tank, { temperature: 48, target: 50, min: 40, max: 65, heating: 0 });
  // No inlet/outlet nor power in the cloud status: those features do not exist.
  for (const key of ['inlet', 'outlet', 'compressor', 'consumedPower', 'heatPower']) {
    assert.equal(s[key], undefined, key);
  }
});

test('heat only, defrosting, heating water, an error, no temperature: the snapshot', () => {
  const s = parseStatus(fx.statusHeatOnlyError(), { guid: fx.GUID_2, name: 'Garage' });
  assert.equal(s.name, 'PAC garage', 'a2wName first');
  assert.equal(s.cooling, false);
  assert.equal(s.zones[0].cool, null);
  assert.equal(s.zones[0].temperature, null, '126 = no sensor');
  assert.equal(s.zones[1].heat, null, 'a zone without setpoint');
  assert.equal(s.tank.heating, 1);
  assert.equal(s.operatingState, THERMOSTAT_OPERATING_STATE.IDLE);
  assert.equal(s.defrost, 1);
  assert.equal(s.powerful, 1);
  assert.deepEqual(s.error, { code: 'H62', message: 'Water flow switch abnormality' });
});

test('the room mode: off when the unit is off or only makes hot water', () => {
  const answer = fx.statusTwoZones();
  answer.status.operationStatus = 0;
  assert.equal(parseStatus(answer, DEVICE).mode, THERMOSTAT_MODE.OFF);
  assert.equal(parseStatus(answer, DEVICE).operatingState, THERMOSTAT_OPERATING_STATE.IDLE);
  assert.equal(parseStatus(fx.statusTankOnly(), DEVICE).mode, THERMOSTAT_MODE.OFF);
  for (const [mode, expected] of [
    [2, THERMOSTAT_MODE.COOLING],
    [3, THERMOSTAT_MODE.AUTO],
    [4, THERMOSTAT_MODE.AUTO],
  ]) {
    const a = fx.statusTwoZones();
    a.status.operationMode = mode;
    assert.equal(parseStatus(a, DEVICE).mode, expected, `operationMode ${mode}`);
  }
  const cooling = fx.statusTwoZones();
  cooling.status.operationMode = 4;
  assert.equal(parseStatus(cooling, DEVICE).operatingState, THERMOSTAT_OPERATING_STATE.COOLING);
});

test('a status in a list (older answers) and a missing one', () => {
  const answer = fx.statusTwoZones();
  answer.status = [answer.status];
  assert.equal(parseStatus(answer, DEVICE).power, 1);
  assert.throws(() => statusOf({}), { kind: 'protocol' });
});

test('on/off resends the zone and tank statuses, and wakes the zones of an idle unit', () => {
  const raw = fx.statusTwoZones().status;
  assert.deepEqual(commandBody('binary', 0, raw), {
    operationStatus: 0,
    zoneStatus: [
      { zoneId: 1, operationStatus: 1 },
      { zoneId: 2, operationStatus: 1 },
    ],
    tankStatus: { operationStatus: 1 },
  });
  raw.tankStatus.operationStatus = 0;
  for (const z of raw.zoneStatus) {
    z.operationStatus = 0;
  }
  assert.deepEqual(commandBody('binary', 1, raw).zoneStatus, [
    { zoneId: 1, operationStatus: 1 },
    { zoneId: 2, operationStatus: 1 },
  ]);
});

test('a mode sets every zone, keeps the tank; off keeps the hot water running', () => {
  const raw = fx.statusTwoZones().status;
  assert.deepEqual(commandBody('mode', THERMOSTAT_MODE.COOLING, raw), {
    operationMode: 3,
    operationStatus: 1,
    zoneStatus: [
      { zoneId: 1, operationStatus: 1 },
      { zoneId: 2, operationStatus: 1 },
    ],
    tankStatus: { operationStatus: 1 },
  });
  assert.equal(commandBody('mode', THERMOSTAT_MODE.AUTO, raw).operationMode, 8);
  assert.equal(commandBody('mode', THERMOSTAT_MODE.HEATING, raw).operationMode, 2);
  assert.deepEqual(commandBody('mode', THERMOSTAT_MODE.OFF, raw), {
    operationMode: 0,
    operationStatus: 1,
    zoneStatus: [
      { zoneId: 1, operationStatus: 0 },
      { zoneId: 2, operationStatus: 0 },
    ],
    tankStatus: { operationStatus: 1 },
  });
  raw.tankStatus.operationStatus = 0;
  assert.equal(commandBody('mode', THERMOSTAT_MODE.OFF, raw).operationStatus, 0);
  assert.throws(() => commandBody('mode', 9, raw), /unknown mode/);
});

test('setpoints are rounded and kept within the range of the zone or tank', () => {
  const raw = fx.statusTwoZones().status;
  assert.deepEqual(commandBody('zone1-heat-setpoint', 2.6, raw), {
    zoneStatus: [{ zoneId: 1, heatSet: 3 }],
  });
  assert.deepEqual(commandBody('zone1-heat-setpoint', 9, raw), {
    zoneStatus: [{ zoneId: 1, heatSet: 5 }],
  });
  assert.deepEqual(commandBody('zone2-cool-setpoint', 18, raw), {
    zoneStatus: [{ zoneId: 2, coolSet: 18 }],
  });
  assert.deepEqual(commandBody('tank-setpoint', 80, raw), { tankStatus: { heatSet: 65 } });
  assert.deepEqual(commandBody('quiet-mode', '3', raw), { quietMode: 3 });
  assert.throws(() => commandBody('tank-setpoint', 'hot', raw), /not a number/);
  assert.throws(() => commandBody('outdoor-temperature', 1, raw), /cannot be controlled/);
});

test('the consumption: finished days only, the three uses added, gaps skipped', () => {
  assert.deepEqual(parseConsumption(fx.consumptionOctober, '2026-10-15'), [
    { date: '2026-10-13', kwh: 8.5 },
    { date: '2026-10-14', kwh: 9.15 },
  ]);
  assert.deepEqual(parseConsumption({}, '2026-10-15'), []);
});

test('the hot water setpoint: never above 65 °C nor the ceiling; a lower heat pump limit wins', () => {
  const raw = fx.statusTwoZones().status; // heatMin 40, heatMax 65
  const heatSet = (value, r = raw, options) =>
    commandBody('tank-setpoint', value, r, options).tankStatus.heatSet;
  assert.equal(heatSet(65), 65);
  assert.equal(heatSet(66), 65);
  // A heat pump that reports 75 °C as its limit (read back): still 65.
  const hot = fx.statusHeatOnlyError().status; // heatMax 75
  assert.equal(heatSet(65, hot), 65);
  assert.equal(heatSet(75, hot), 65);
  assert.equal(heatSet(Number(hot.tankStatus.heatMax), hot), 65);
  assert.equal(heatSet(70, hot, { tankCap: 99 }), 65);
  // The configured ceiling, lower.
  assert.equal(heatSet(65, hot, { tankCap: 55 }), 55);
  assert.equal(heatSet(52, hot, { tankCap: 55 }), 52);
  // The heat pump's own limit, lower than the ceiling, wins.
  const low = fx.statusTwoZones().status;
  low.tankStatus.heatMax = 60;
  assert.equal(heatSet(65, low), 60);
  // No limit reported: the ceiling still holds.
  const unknown = fx.statusTwoZones().status;
  delete unknown.tankStatus.heatMax;
  assert.equal(heatSet(80, unknown), 65);
  // A heat pump whose floor is above the ceiling: nothing is sent.
  const floor = fx.statusTwoZones().status;
  floor.tankStatus.heatMin = 50;
  assert.throws(
    () => commandBody('tank-setpoint', 45, floor, { tankCap: 45 }),
    /no hot water setpoint/,
  );
});
