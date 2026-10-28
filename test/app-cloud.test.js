// -----------------------------------------------------------------------------
// The whole integration over Aquarea Smart Cloud: the SDK's fake Gladys, the
// handlers of the container, the real Panasonic client on a fake cloud.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AquareaApp } from '../src/app.js';
import { createHttp } from '../src/cloud/http.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { GUID } from './fixtures/cloud.js';
import { createFakePanasonic } from './helpers/fakePanasonic.js';
import { fastTimers, sleep, waitFor } from './helpers/harness.js';

// Noon on the 15th (local time): the 13th and the 14th are finished days.
const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime();
const ID = `ext:test-integration:aquarea:${GUID}`;
const keys = (device) => device.features.map((f) => f.external_id.split(':').pop());

async function start({ fakeOptions = {}, config = {}, store = memoryStore() } = {}) {
  const fake = createFakePanasonic({ now: () => NOW, ...fakeOptions });
  const gladys = createFakeGladys({
    config: {
      panasonic_id: 'louis@example.com',
      panasonic_password: 'secret-password',
      language: 'fr',
      ...config,
    },
  });
  const app = new AquareaApp({
    gladys,
    store,
    logger: createLogger({ level: 'silent' }),
    timers: fastTimers(),
    now: () => NOW,
    sourceDeps: { request: createHttp({ fetch: fake.fetch }), sleep: async () => {} },
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  return { gladys, app, fake, store };
}

test('the heat pump of the account in Discovery, with the features the cloud reports', async (t) => {
  const { gladys, app, store } = await start();
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1, 3000, 'discovery');
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, ID);
  assert.equal(device.name, 'PAC maison');
  assert.deepEqual(keys(device), [
    'binary',
    'mode',
    'operating-state',
    'zone1-temperature',
    'zone1-heat-setpoint',
    'zone1-cool-setpoint',
    'zone2-temperature',
    'zone2-heat-setpoint',
    'zone2-cool-setpoint',
    'tank-temperature',
    'tank-setpoint',
    'tank-heating',
    'outdoor-temperature',
    'daily-consumption',
    'quiet-mode',
    'powerful-mode',
    'defrost',
    'error',
  ]);
  const feature = (key) => device.features.find((f) => f.external_id === `${ID}:${key}`);
  assert.equal(feature('zone1-heat-setpoint').name, 'Décalage (courbe) chauffage zone 1');
  assert.equal(feature('zone2-heat-setpoint').name, 'Consigne chauffage zone 2');
  assert.deepEqual([feature('tank-setpoint').min, feature('tank-setpoint').max], [40, 65]);
  assert.deepEqual(feature('quiet-mode').supported_options[1], { value: '1', label: 'Niveau 1' });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.fr, /1 pompe à chaleur dans Découverte/);
  // The session is kept for the next start; never the password.
  const session = store.docs.get('session');
  assert.ok(session.refreshToken);
  assert.equal(JSON.stringify(session).includes('secret-password'), false);
});

test('once created: the states, the finished days of consumption, the commands', async (t) => {
  const { gladys, app, fake } = await start();
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  const device = gladys.fake.discoveredDevices[0];
  await gladys.fake.deviceCreated(device);
  const state = (key) => gladys.fake.lastState(`${ID}:${key}`);
  await waitFor(() => state('tank-temperature') === 48, 3000, 'values');
  assert.equal(state('mode'), 1);
  assert.equal(state('zone1-temperature'), 21);
  assert.equal(state('zone2-heat-setpoint'), 38);
  assert.equal(state('outdoor-temperature'), 7);
  assert.equal(state('quiet-mode'), '2');
  assert.equal(state('error'), 'OK');

  await waitFor(() => gladys.fake.publishedEnergyConsumption.length > 0, 3000, 'consumption');
  assert.deepEqual(gladys.fake.publishedEnergyConsumption[0], {
    device_feature_external_id: `${ID}:daily-consumption`,
    intervals: [
      { date: '2026-10-13', kwh: 8.5 },
      { date: '2026-10-14', kwh: 9.15 },
    ],
  });
  assert.equal(fake.state.consumptionCalls[0].dataMode, 1);
  assert.equal(fake.state.consumptionCalls[0].date, '20261015');

  const feature = (key) => device.features.find((f) => f.external_id === `${ID}:${key}`);
  assert.deepEqual(await gladys.fake.setValue(device, feature('tank-setpoint'), 55), {
    success: true,
  });
  assert.deepEqual(fake.state.commands.at(-1), {
    gwid: GUID,
    change: { tankStatus: { heatSet: 55 } },
  });
  await waitFor(() => state('tank-setpoint') === 55, 3000, 'echo of the tank setpoint');
  await gladys.fake.setValue(device, feature('tank-setpoint'), 70);
  assert.deepEqual(fake.state.commands.at(-1).change, { tankStatus: { heatSet: 65 } });
  await gladys.fake.setValue(device, feature('mode'), 2);
  assert.equal(fake.state.commands.at(-1).change.operationMode, 3);
  await waitFor(() => state('mode') === 2, 3000, 'echo of the mode');
  await gladys.fake.setValue(device, feature('zone2-heat-setpoint'), 40);
  assert.deepEqual(fake.state.commands.at(-1).change, { zoneStatus: [{ zoneId: 2, heatSet: 40 }] });
  await gladys.fake.setValue(device, feature('quiet-mode'), '0');
  assert.deepEqual(fake.state.commands.at(-1).change, { quietMode: 0 });
});

test('the hot water ceiling of the configuration on the cloud: the slider and the command', async (t) => {
  const { gladys, app, fake } = await start({ config: { dhw_max_temperature: 55 } });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1, 3000, 'discovery');
  const [device] = gladys.fake.discoveredDevices;
  await gladys.fake.deviceCreated(device);
  const tank = device.features.find((f) => f.external_id === `${ID}:tank-setpoint`);
  assert.deepEqual([tank.min, tank.max], [40, 55], 'the heat pump accepts 65, the ceiling is 55');
  assert.deepEqual(await gladys.fake.setValue(device, tank, 70), { success: true });
  assert.deepEqual(fake.state.commands.at(-1), {
    gwid: GUID,
    change: { tankStatus: { heatSet: 55 } },
  });
  await gladys.fake.setValue(device, tank, 52);
  assert.deepEqual(fake.state.commands.at(-1).change, { tankStatus: { heatSet: 52 } });
});

test('an adapter that does not answer live: the cloud copy, and a degraded badge', async (t) => {
  const { gladys, app, fake } = await start();
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await waitFor(() => gladys.fake.transports.at(-1)?.transport === 'cloud');
  fake.state.offline.add(GUID);
  await waitFor(() => gladys.fake.transports.at(-1)?.degraded === true, 5000, 'degraded badge');
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');
  assert.match(gladys.fake.transports.at(-1).message.en, /does not answer live/);
  const reads = fake.state.statusCalls.filter((c) => c.guid === GUID);
  assert.deepEqual(reads.slice(-2), [
    { guid: GUID, live: true },
    { guid: GUID, live: false },
  ]);
  assert.match(gladys.fake.connectionStatus.message.en, /copy the cloud kept/);
});

test('the connection test reads the heat pumps with the saved configuration', async (t) => {
  const { gladys, app } = await start();
  t.after(() => app.stop());
  const answer = await gladys.fake.action('test_connection');
  assert.equal(answer.success, true);
  assert.equal(
    answer.data.message.en,
    'Connected to Aquarea Smart Cloud: 1 heat pump. PAC maison (WH-MDC09J3E5): heating, outdoor 7 °C, zone 1 21 °C, tank 48 °C',
  );
});

test('a refused password: the status says so, and no retry sends it again', async (t) => {
  const { gladys, app, fake } = await start({ config: { panasonic_password: 'wrong' } });
  t.after(() => app.stop());
  await waitFor(() =>
    gladys.fake.connectionStatus?.message?.en?.includes('refused the Panasonic ID'),
  );
  const sent = fake.state.passwordsSent;
  await sleep(300);
  assert.equal(fake.state.passwordsSent, sent);
  const answer = await gladys.fake.action('test_connection');
  assert.match(answer.data.message.fr, /a refusé le Panasonic ID/);
});

test('a two-factor account: the code button completes the login', async (t) => {
  const { gladys, app } = await start({ fakeOptions: { mfa: true } });
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.connectionStatus?.message?.en?.includes('two-factor code'));
  const bad = await gladys.fake.action('two_factor_code', { code: 'abc' });
  assert.match(bad.data.message.en, /6-digit code/);
  const wrong = await gladys.fake.action('two_factor_code', { code: '000000' });
  assert.match(wrong.data.message.en, /two-factor code/);
  const right = await gladys.fake.action('two_factor_code', { code: '123456' });
  assert.match(right.data.message.en, /Code accepted/);
  await waitFor(() => gladys.fake.discoveredDevices.length === 1, 3000, 'discovery after the code');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a heat pump reporting a new error fires the scene trigger', async (t) => {
  const { gladys, app, fake } = await start();
  t.after(() => app.stop());
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await waitFor(() => gladys.fake.lastState(`${ID}:error`) === 'OK');
  fake.state.statuses.get(GUID).status.faultStatus = [
    { errorCode: 'H75', errorMessage: 'Low water temperature' },
  ];
  await waitFor(() => gladys.fake.sceneEvents.length === 1, 5000, 'scene event');
  assert.deepEqual(gladys.fake.sceneEvents[0].data, {
    device: ID,
    code: 'H75',
    message: 'Low water temperature',
    heat_pump: 'PAC maison',
  });
});
