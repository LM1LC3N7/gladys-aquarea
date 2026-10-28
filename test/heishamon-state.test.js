// -----------------------------------------------------------------------------
// HeishaMon topics as a snapshot, and the commands of the Gladys values.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THERMOSTAT_MODE, THERMOSTAT_OPERATING_STATE } from '../src/constants.js';
import { HeishamonState, isError, parseValue } from '../src/heishamon/state.js';
import { BASE, dump, extraBlock } from './fixtures/heishamon.js';

function stateOf(values = dump(), changes = {}) {
  const state = new HeishamonState(BASE);
  for (const [topic, payload] of Object.entries({ ...values, ...changes })) {
    if (topic === 'LWT') {
      state.lwt = payload;
      continue;
    }
    const [group, name] = topic.split('/');
    state.apply(group, name, Buffer.from(payload), 1000);
  }
  return state;
}

test('payloads: numbers, texts, unknown states', () => {
  assert.equal(parseValue('Main_Outlet_Temp', '34.5'), 34.5);
  assert.equal(parseValue('Main_Outlet_Temp', '-1'), -1, 'a temperature may be -1');
  assert.equal(parseValue('Heatpump_State', '-1'), null, '-1: unknown state');
  assert.equal(parseValue('Error', 'H62'), 'H62');
  assert.equal(parseValue('Outside_Temp', 'nan'), null);
  assert.equal(parseValue('Outside_Temp', ''), null);
  assert.ok(isError('H62') && isError('F1A'));
  assert.ok(!isError('No error') && !isError(''));
});

test('apply tells a change apart from a repeated value', () => {
  const state = new HeishamonState(BASE);
  assert.equal(state.apply('main', 'Outside_Temp', '6', 1), true);
  assert.equal(state.apply('main', 'Outside_Temp', '6', 2), false);
  assert.equal(state.lastAt, 2);
  assert.equal(state.apply('main', 'Outside_Temp', '5', 3), true);
  assert.equal(new HeishamonState(BASE).ready, false);
});

test('the dump of a heating monobloc with a tank: the snapshot', () => {
  const s = stateOf().snapshot();
  assert.equal(s.platformId, BASE);
  assert.equal(s.model, 'WH-MDC09J3E5');
  assert.equal(s.power, 1);
  assert.equal(s.mode, THERMOSTAT_MODE.HEATING, 'Heat+DHW');
  assert.equal(s.operatingState, THERMOSTAT_OPERATING_STATE.HEATING);
  assert.equal(s.cooling, true);
  assert.equal(s.zones.length, 1, 'Zones_State 0: zone 1 only');
  assert.deepEqual(s.zones[0], {
    id: 1,
    temperature: 20.5,
    waterSensor: false,
    heat: { target: 0, min: -5, max: 5, shift: true },
    cool: { target: 0, min: -5, max: 5, shift: true },
  });
  assert.deepEqual(s.tank, { temperature: 47, target: 50, min: 40, max: 75, heating: 0 });
  assert.equal(s.outdoor, 6);
  assert.equal(s.inlet, 30.25);
  assert.equal(s.outlet, 34.5);
  assert.equal(s.compressor, 38);
  assert.equal(s.consumedPower, 800);
  assert.equal(s.heatPower, 3200);
  assert.equal(s.quiet, 1);
  assert.equal(s.powerful, 0);
  assert.equal(s.defrost, 0);
  assert.deepEqual(s.error, { code: null, message: 'No error' });
});

test('two zones, direct setpoints, a water sensor', () => {
  const s = stateOf(dump(), {
    'main/Zones_State': '2',
    'main/Heating_Mode': '1',
    'main/Z2_Sensor_Settings': '0',
    'main/Z2_Temp': '33',
    'main/Z2_Heat_Request_Temp': '35',
  }).snapshot();
  assert.equal(s.zones.length, 2);
  assert.deepEqual(s.zones[1].heat, { target: 35, min: 20, max: 65, shift: false });
  assert.equal(s.zones[1].waterSensor, true);
  assert.equal(s.zones[1].temperature, 33);
});

test('the modes: off, hot water only, cooling, auto; the tank heating', () => {
  assert.equal(
    stateOf(dump(), { 'main/Heatpump_State': '0' }).snapshot().mode,
    THERMOSTAT_MODE.OFF,
  );
  const dhw = stateOf(dump(), {
    'main/Operating_Mode_State': '3',
    'main/ThreeWay_Valve_State': '1',
  }).snapshot();
  assert.equal(dhw.mode, THERMOSTAT_MODE.OFF);
  assert.equal(dhw.operatingState, THERMOSTAT_OPERATING_STATE.IDLE);
  assert.equal(dhw.tank.heating, 1);
  const cool = stateOf(dump(), { 'main/Operating_Mode_State': '5' }).snapshot();
  assert.equal(cool.mode, THERMOSTAT_MODE.COOLING);
  assert.equal(cool.operatingState, THERMOSTAT_OPERATING_STATE.COOLING);
  const autoCool = stateOf(dump(), { 'main/Operating_Mode_State': '7' }).snapshot();
  assert.equal(autoCool.mode, THERMOSTAT_MODE.AUTO);
  assert.equal(autoCool.operatingState, THERMOSTAT_OPERATING_STATE.COOLING);
  const stopped = stateOf(dump(), { 'main/Compressor_Freq': '0' }).snapshot();
  assert.equal(stopped.operatingState, THERMOSTAT_OPERATING_STATE.IDLE);
});

test('the extra data block replaces the invalid main power values', () => {
  const s = stateOf({ ...dump(), ...extraBlock() }).snapshot();
  assert.equal(s.consumedPower, 740);
  assert.equal(s.heatPower, 3050);
  const bogus = stateOf(dump(), { 'main/Heat_Power_Consumption': '-200' }).snapshot();
  assert.equal(bogus.consumedPower, null, 'a negative total is no reading');
});

test('an error code; no tank; a heat pump not read yet', () => {
  assert.deepEqual(stateOf(dump(), { 'main/Error': 'H62' }).snapshot().error, {
    code: 'H62',
    message: 'H62',
  });
  const noTank = stateOf(dump(), { 'main/DHW_Installed': '0' }).snapshot();
  assert.equal(noTank.tank, null);
  const partial = new HeishamonState(BASE);
  partial.apply('main', 'Outside_Temp', '4', 1);
  const s = partial.snapshot();
  assert.equal(s.power, undefined, 'no topic, no feature');
  assert.equal(s.mode, undefined);
  assert.equal(s.outdoor, 4);
});

test('commands: on/off, setpoints within their range, tank, quiet', () => {
  const state = stateOf();
  assert.deepEqual(state.commands('binary', 0), [{ name: 'SetHeatpump', value: 0 }]);
  assert.deepEqual(state.commands('zone1-heat-setpoint', 3.4), [
    { name: 'SetZ1HeatRequestTemperature', value: 3 },
  ]);
  assert.deepEqual(state.commands('zone1-heat-setpoint', 30), [
    { name: 'SetZ1HeatRequestTemperature', value: 5 },
  ]);
  assert.deepEqual(state.commands('zone2-cool-setpoint', -9), [
    { name: 'SetZ2CoolRequestTemperature', value: -5 },
  ]);
  assert.deepEqual(state.commands('tank-setpoint', 55), [{ name: 'SetDHWTemp', value: 55 }]);
  assert.deepEqual(state.commands('quiet-mode', '2'), [{ name: 'SetQuietMode', value: 2 }]);
  const direct = stateOf(dump(), { 'main/Heating_Mode': '1' });
  assert.deepEqual(direct.commands('zone1-heat-setpoint', 38), [
    { name: 'SetZ1HeatRequestTemperature', value: 38 },
  ]);
  assert.throws(() => state.commands('outlet-temperature', 1), /cannot be controlled/);
  assert.throws(() => state.commands('binary', 'x'), /not a number/);
});

test('mode commands keep the hot water as it was', () => {
  // Heat+DHW now.
  const state = stateOf();
  assert.deepEqual(state.commands('mode', THERMOSTAT_MODE.OFF), [
    { name: 'SetOperationMode', value: 3 },
  ]);
  assert.deepEqual(state.commands('mode', THERMOSTAT_MODE.COOLING), [
    { name: 'SetOperationMode', value: 5 },
  ]);
  assert.deepEqual(state.commands('mode', THERMOSTAT_MODE.AUTO), [
    { name: 'SetOperationMode', value: 6 },
  ]);
  // Heat only: off stops the heat pump; a mode while off switches it on.
  const heatOnly = stateOf(dump(), { 'main/Operating_Mode_State': '0' });
  assert.deepEqual(heatOnly.commands('mode', THERMOSTAT_MODE.OFF), [
    { name: 'SetHeatpump', value: 0 },
  ]);
  const off = stateOf(dump(), { 'main/Operating_Mode_State': '0', 'main/Heatpump_State': '0' });
  assert.deepEqual(off.commands('mode', THERMOSTAT_MODE.OFF), []);
  assert.deepEqual(off.commands('mode', THERMOSTAT_MODE.HEATING), [
    { name: 'SetOperationMode', value: 0 },
    { name: 'SetHeatpump', value: 1 },
  ]);
  assert.throws(() => state.commands('mode', 7), /unknown mode/);
});

test('the hot water setpoint: 65 °C passes, above is brought back, never written higher', () => {
  const state = stateOf();
  const dhw = (value, options) => state.commands('tank-setpoint', value, options)[0].value;
  assert.equal(dhw(65), 65);
  assert.equal(dhw(64.6), 65);
  assert.equal(dhw(65.4), 65);
  assert.equal(dhw(66), 65, 'HeishaMon would take 75: brought back to 65');
  assert.equal(dhw(75), 65);
  assert.equal(dhw(1e9), 65);
  assert.equal(dhw(30), 40, "HeishaMon's floor");
  // The configured ceiling, lower; a raw one above 65 still stops at 65.
  assert.equal(dhw(65, { tankCap: 50 }), 50);
  assert.equal(dhw(48, { tankCap: 50 }), 48);
  assert.equal(dhw(70, { tankCap: 99 }), 65);
  assert.equal(dhw(70, { tankCap: 'x' }), 65);
  // A setpoint read back above 65 (set on the unit) is published, never resent higher.
  const high = stateOf(dump(), { 'main/DHW_Target_Temp': '70' });
  assert.equal(high.snapshot().tank.target, 70);
  assert.equal(high.commands('tank-setpoint', high.snapshot().tank.target)[0].value, 65);
});
