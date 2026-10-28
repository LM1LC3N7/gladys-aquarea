// -----------------------------------------------------------------------------
// The whole integration over HeishaMon: the SDK's fake Gladys, the handlers of
// the container, an in-memory MQTT broker (or a fake board page for HTTP).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AquareaApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { BASE, dump, jsonPage } from './fixtures/heishamon.js';
import { fakeBroker, fastTimers, sleep, waitFor } from './helpers/harness.js';

const ID = `ext:test-integration:heishamon:${BASE}`;
const keys = (device) => device.features.map((f) => f.external_id.split(':').pop());

async function start({ config = {}, broker = fakeBroker(), get, now, store = memoryStore() } = {}) {
  const gladys = createFakeGladys({
    config: { heishamon_url: 'mqtt://192.168.1.10', language: 'en', ...config },
  });
  const app = new AquareaApp({
    gladys,
    store,
    logger: createLogger({ level: 'silent' }),
    timers: fastTimers(),
    ...(now ? { now } : {}),
    sourceDeps: { connect: broker.connect, ...(get ? { get } : {}) },
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  return { gladys, app, broker, store };
}

/** A broker holding the retained values of one HeishaMon. */
function brokerWithDump(values = dump()) {
  const broker = fakeBroker();
  broker.publishAll(BASE, values);
  return broker;
}

test('the retained values make one heat pump in Discovery, with every feature', async (t) => {
  const { gladys, app } = await start({ broker: brokerWithDump() });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1, 3000, 'discovery');
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, ID);
  assert.equal(device.name, 'Aquarea heat pump');
  assert.deepEqual(keys(device), [
    'binary',
    'mode',
    'operating-state',
    'zone1-temperature',
    'zone1-heat-setpoint',
    'zone1-cool-setpoint',
    'tank-temperature',
    'tank-setpoint',
    'tank-heating',
    'outdoor-temperature',
    'inlet-temperature',
    'outlet-temperature',
    'compressor-frequency',
    'power-consumed',
    'energy-consumed',
    'heat-produced',
    'quiet-mode',
    'powerful-mode',
    'defrost',
    'error',
  ]);
  const feature = (key) => device.features.find((f) => f.external_id === `${ID}:${key}`);
  assert.equal(feature('zone1-heat-setpoint').name, 'Zone 1 heating shift (curve)');
  assert.deepEqual(
    [feature('zone1-heat-setpoint').min, feature('zone1-heat-setpoint').max],
    [-5, 5],
  );
  assert.deepEqual(
    feature('mode').supported_options.map((o) => o.value),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    device.params.find((p) => p.name === 'AQUAREA_MODEL'),
    {
      name: 'AQUAREA_MODEL',
      value: 'WH-MDC09J3E5',
    },
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /1 heat pump in Discovery/);
  // Nothing is sent before the user creates the device.
  assert.equal(gladys.fake.states.length, 0);
});

test('once created, the values are sent, and the changes follow', async (t) => {
  const { gladys, app, broker } = await start({ broker: brokerWithDump() });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  const state = (key) => gladys.fake.lastState(`${ID}:${key}`);
  await waitFor(() => state('outdoor-temperature') === 6, 3000, 'values at creation');
  assert.equal(state('binary'), 1);
  assert.equal(state('mode'), 1);
  assert.equal(state('operating-state'), 1);
  assert.equal(state('zone1-temperature'), 20.5);
  assert.equal(state('tank-temperature'), 47);
  assert.equal(state('tank-setpoint'), 50);
  assert.equal(state('outlet-temperature'), 34.5);
  assert.equal(state('compressor-frequency'), 38);
  assert.equal(state('power-consumed'), 800);
  assert.equal(state('heat-produced'), 3200);
  assert.equal(state('quiet-mode'), '1');
  assert.equal(state('error'), 'OK');
  assert.equal(state('energy-consumed'), 0);

  broker.publish(`${BASE}/main/Operating_Mode_State`, '3');
  broker.publish(`${BASE}/main/DHW_Target_Temp`, '55');
  await waitFor(() => state('mode') === 0 && state('tank-setpoint') === 55, 3000, 'changes');
  const badge = gladys.fake.transports.at(-1);
  assert.deepEqual([badge.device_external_id, badge.transport], [ID, 'local']);
});

test('commands are published on the command topics of HeishaMon', async (t) => {
  const { gladys, app, broker } = await start({ broker: brokerWithDump() });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  const device = gladys.fake.discoveredDevices[0];
  await gladys.fake.deviceCreated(device);
  const feature = (key) => device.features.find((f) => f.external_id === `${ID}:${key}`);
  const sent = (from) => broker.published.slice(from).map((p) => `${p.topic}=${p.payload}`);

  assert.deepEqual(await gladys.fake.setValue(device, feature('mode'), 2), { success: true });
  assert.deepEqual(sent(0), [`${BASE}/commands/SetOperationMode=5`]);
  await gladys.fake.setValue(device, feature('zone1-heat-setpoint'), 3);
  await gladys.fake.setValue(device, feature('tank-setpoint'), 52);
  await gladys.fake.setValue(device, feature('quiet-mode'), '3');
  await gladys.fake.setValue(device, feature('binary'), 0);
  assert.deepEqual(sent(1), [
    `${BASE}/commands/SetZ1HeatRequestTemperature=3`,
    `${BASE}/commands/SetDHWTemp=52`,
    `${BASE}/commands/SetQuietMode=3`,
    `${BASE}/commands/SetHeatpump=0`,
  ]);
  const refused = await gladys.fake.setValue(device, feature('outdoor-temperature'), 3);
  assert.equal(refused.success, false);
});

test('the hot water ceiling of the configuration: the slider and the command', async (t) => {
  const { gladys, app, broker } = await start({
    broker: brokerWithDump(),
    config: { dhw_max_temperature: 55 },
  });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  const device = gladys.fake.discoveredDevices[0];
  await gladys.fake.deviceCreated(device);
  const tank = device.features.find((f) => f.external_id === `${ID}:tank-setpoint`);
  assert.deepEqual([tank.min, tank.max], [40, 55]);
  const from = broker.published.length;
  await gladys.fake.setValue(device, tank, 70);
  await gladys.fake.setValue(device, tank, 50);
  assert.deepEqual(
    broker.published.slice(from).map((p) => `${p.topic}=${p.payload}`),
    [`${BASE}/commands/SetDHWTemp=55`, `${BASE}/commands/SetDHWTemp=50`],
  );
});

test('a new error code fires the scene trigger once; the code at connection does not', async (t) => {
  const { gladys, app, broker } = await start({
    broker: brokerWithDump({ ...dump(), 'main/Error': 'F12' }),
  });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await waitFor(() => gladys.fake.lastState(`${ID}:error`) === 'F12');
  broker.publish(`${BASE}/main/Error`, 'H62');
  await waitFor(() => gladys.fake.sceneEvents.length === 1, 3000, 'scene event');
  assert.deepEqual(gladys.fake.sceneEvents[0], {
    key: 'heat_pump_error',
    data: { device: ID, code: 'H62', message: 'H62', heat_pump: BASE },
  });
  broker.publish(`${BASE}/main/Error`, 'No error');
  await waitFor(() => gladys.fake.lastState(`${ID}:error`) === 'OK');
  broker.publish(`${BASE}/main/Error`, 'H62');
  await waitFor(() => gladys.fake.sceneEvents.length === 2, 3000, 'second error');
});

test('HeishaMon offline (its last will), then the broker gone: the badges and the status', async (t) => {
  const { gladys, app, broker } = await start({ broker: brokerWithDump() });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  broker.publish(`${BASE}/LWT`, 'Offline');
  await waitFor(() => gladys.fake.transports.at(-1)?.degraded === true, 3000, 'offline badge');
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.match(gladys.fake.connectionStatus.message.fr, /hors ligne/);
  broker.publish(`${BASE}/LWT`, 'Online');
  await waitFor(() => gladys.fake.transports.at(-1)?.transport === 'local');
  broker.drop();
  await waitFor(() => gladys.fake.connectionStatus.connected === false, 3000, 'link lost');
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
});

test('the energy index integrates the power consumed, and survives a restart', async (t) => {
  let clock = Date.parse('2026-10-15T10:00:00Z');
  const now = () => clock;
  const store = memoryStore();
  // No measurement throttling here: the clock of the test only moves on purpose
  // (the throttling has its own tests in publisher.test.js).
  const config = { sensor_interval: 0 };
  const first = await start({ broker: brokerWithDump(), now, store, config });
  t.after(() => first.app.stop());
  await waitFor(() => first.gladys.fake.discoveredDevices.length === 1);
  await first.gladys.fake.deviceCreated(first.gladys.fake.discoveredDevices[0]);
  // HeishaMon resends its values every 5 minutes: 800 W for 30 minutes, then
  // 1200 W for 15 minutes, make 0.4 + 0.3 kWh.
  const hold = async (watts, minutes) => {
    for (let i = 0; i < minutes / 5; i += 1) {
      clock += 5 * 60_000;
      first.broker.publish(`${BASE}/main/Heat_Power_Consumption`, watts);
      await sleep(20);
    }
  };
  await hold('800', 30);
  first.broker.publish(`${BASE}/main/Heat_Power_Consumption`, '1200');
  await sleep(20);
  await hold('1200', 15);
  const sent = (key) =>
    first.gladys.fake.states
      .filter((s) => s.device_feature_external_id === `${ID}:${key}`)
      .map((s) => s.state);
  await waitFor(
    () => first.gladys.fake.lastState(`${ID}:energy-consumed`) === 0.7,
    3000,
    `energy index 0.7 (index sent: ${sent('energy-consumed')}; power: ${sent('power-consumed')})`,
  ).catch((err) => {
    throw new Error(`${err.message}; sent at the end: ${sent('energy-consumed')}`);
  });
  first.app.stop();
  assert.deepEqual(store.docs.get('energy'), { totals: { [ID]: 0.7 } });

  // A restart reads the index back: it never goes down.
  const second = await start({ broker: first.broker, now, store, config });
  t.after(() => second.app.stop());
  await waitFor(() => second.gladys.fake.discoveredDevices.length === 1);
  await second.gladys.fake.deviceCreated(second.gladys.fake.discoveredDevices[0]);
  await waitFor(() => second.gladys.fake.lastState(`${ID}:energy-consumed`) === 0.7);
});

test('a broker that refuses the credentials', async (t) => {
  const { gladys, app } = await start({ broker: fakeBroker({ refuse: 5 }) });
  t.after(() => app.stop());
  await waitFor(
    () =>
      gladys.fake.connectionStatus?.connected === false &&
      /refused/.test(gladys.fake.connectionStatus.message.en),
  );
  assert.match(gladys.fake.connectionStatus.message.en, /not authorized/);
});

test('the connection test lists what HeishaMon publishes', async (t) => {
  const { gladys, app } = await start({ broker: brokerWithDump() });
  t.after(() => app.stop());
  const answer = await gladys.fake.action('test_connection');
  assert.equal(answer.success, true);
  assert.match(
    answer.data.message.en,
    /HeishaMon publishes\. panasonic_heat_pump \(WH-MDC09J3E5\): heating, outdoor 6 °C/,
  );
  assert.match(answer.data.message.fr, /chauffage, extérieur 6 °C/);
  const twoFactor = await gladys.fake.action('two_factor_code', { code: '123456' });
  assert.match(twoFactor.data.message.en, /reads HeishaMon/);
});

test('several base topics: one device each, named after the topic', async (t) => {
  const broker = brokerWithDump();
  broker.publishAll('heatpump_garage', dump());
  const { gladys, app } = await start({
    broker,
    config: { heishamon_topic: `${BASE}, heatpump_garage` },
  });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 2);
  assert.deepEqual(gladys.fake.discoveredDevices.map((d) => d.name).sort(), [
    'Aquarea heat pump (heatpump_garage)',
    'Aquarea heat pump (panasonic_heat_pump)',
  ]);
});

test('without a broker: the /json page of the board, and /command', async (t) => {
  const pages = [jsonPage()];
  const requested = [];
  const get = async (url) => {
    requested.push(url);
    if (url.includes('/command?')) {
      return 'OK';
    }
    return pages.at(-1);
  };
  const { gladys, app } = await start({
    config: { heishamon_url: 'http://192.168.1.30', http_interval: 5 },
    get,
  });
  t.after(() => app.stop());
  const id = 'ext:test-integration:heishamon:192.168.1.30';
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  const device = gladys.fake.discoveredDevices[0];
  assert.equal(device.external_id, id);
  await gladys.fake.deviceCreated(device);
  await waitFor(() => gladys.fake.lastState(`${id}:outdoor-temperature`) === 6);
  const tank = device.features.find((f) => f.external_id === `${id}:tank-setpoint`);
  await gladys.fake.setValue(device, tank, 48);
  assert.ok(requested.includes('http://192.168.1.30/command?SetDHWTemp=48'));
  pages.push(jsonPage({ ...dump(), 'main/DHW_Target_Temp': '48' }));
  await waitFor(() => gladys.fake.lastState(`${id}:tank-setpoint`) === 48, 3000, 'echo');
  const answer = await gladys.fake.action('test_connection');
  assert.match(answer.data.message.en, /^HeishaMon answers\./);
});

test('a configuration error is shown, nothing starts', async (t) => {
  const { gladys, app } = await start({ config: { heishamon_url: 'ftp://x' } });
  t.after(() => app.stop());
  assert.match(gladys.fake.connectionStatus.message.en, /not valid/);
  const empty = await start({ config: { heishamon_url: '' } });
  t.after(() => empty.app.stop());
  assert.match(
    empty.gladys.fake.connectionStatus.message.en,
    /Panasonic ID .* or the address of your HeishaMon/,
  );
  const answer = await empty.gladys.fake.action('test_connection');
  assert.match(answer.data.message.en, /Fill in/);
});
