// -----------------------------------------------------------------------------
// The Gladys devices of the snapshots: the features each source gives, their
// names, and Gladys accepting them (the SDK's fake checks categories, types
// and units like the core).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { parseStatus } from '../src/cloud/status.js';
import { THERMOSTAT_MODE } from '../src/constants.js';
import { HeishamonState } from '../src/heishamon/state.js';
import { buildDevice, featureSpecs, statesOf, supportedModes, WRITABLE } from '../src/model.js';
import * as cloud from './fixtures/cloud.js';
import { BASE, dump, extraBlock } from './fixtures/heishamon.js';

const heishamonSnapshot = (values = dump()) => {
  const state = new HeishamonState(BASE);
  for (const [topic, payload] of Object.entries(values)) {
    const [group, name] = topic.split('/');
    if (name) {
      state.apply(group, name, payload, 0);
    }
  }
  return state.snapshot();
};

const snapshots = () => [
  parseStatus(cloud.statusTwoZones(), { guid: cloud.GUID, model: 'WH-MDC09J3E5' }),
  parseStatus(cloud.statusHeatOnlyError(), { guid: cloud.GUID_2 }),
  heishamonSnapshot(),
  heishamonSnapshot({ ...dump(), ...extraBlock(), 'main/Zones_State': '2' }),
];

test('Gladys accepts every device, in both languages', async () => {
  const gladys = createFakeGladys();
  for (const language of ['en', 'fr']) {
    const devices = snapshots().map((s, i) => {
      const ids = gladys.externalIds(i < 2 ? 'aquarea' : 'heishamon', `${s.platformId}${i}`);
      return buildDevice(ids, s, { language, source: i < 2 ? 'cloud' : 'heishamon' }).device;
    });
    await gladys.publishDiscoveredDevices(devices);
    assert.equal(gladys.fake.discoveredDevices.length, 4);
    for (const device of devices) {
      for (const f of device.features) {
        assert.ok(f.name.length > 0 && f.name.length <= 100, f.name);
        assert.ok(f.min < f.max || f.max === f.min, `${f.external_id} ${f.min}..${f.max}`);
        assert.equal(f.read_only, !WRITABLE.has(f.external_id.split(':').pop()));
      }
    }
  }
});

test('the states of a snapshot are numbers, or texts for the text features', async () => {
  const gladys = createFakeGladys({ devices: [] });
  for (const snapshot of snapshots()) {
    const ids = gladys.externalIds('heishamon', snapshot.platformId);
    const { readers } = buildDevice(ids, snapshot, { language: 'en', source: 'heishamon' });
    const states = statesOf(readers, { ...snapshot, consumedEnergy: 1.5 });
    assert.ok(states.length > 5);
    await gladys.publishStates(
      states.map(({ featureId, value }) => ({ device_feature_external_id: featureId, ...value })),
    );
  }
});

test('no cooling, no cooling mode', () => {
  const heatOnly = parseStatus(cloud.statusHeatOnlyError(), { guid: cloud.GUID_2 });
  assert.deepEqual(supportedModes(heatOnly), [
    THERMOSTAT_MODE.OFF,
    THERMOSTAT_MODE.HEATING,
    THERMOSTAT_MODE.AUTO,
  ]);
  const keys = featureSpecs(heatOnly).map((s) => s.key);
  assert.ok(!keys.some((k) => k.includes('cool')));
  assert.ok(keys.includes('daily-consumption'), 'the cloud gives the consumption per day');
  assert.ok(!keys.includes('energy-consumed'), 'and no power to integrate');
});

test('HeishaMon gives power and energy, no consumption per day', () => {
  const specs = featureSpecs(heishamonSnapshot());
  const keys = specs.map((s) => s.key);
  assert.ok(keys.includes('power-consumed') && keys.includes('energy-consumed'));
  assert.ok(!keys.includes('daily-consumption'));
  const heat = specs.find((s) => s.key === 'heat-produced').feature;
  assert.notEqual(heat.category, 'energy-sensor', 'thermal power never counts as electricity');
  const energy = specs.find((s) => s.key === 'energy-consumed').feature;
  assert.deepEqual(
    [energy.category, energy.type, energy.unit],
    ['energy-sensor', 'energy', 'kilowatt-hour'],
  );
  const outdoor = specs.find((s) => s.key === 'outdoor-temperature').feature;
  assert.equal(outdoor.type, 'probe', 'kept out of the room average');
  const zone = specs.find((s) => s.key === 'zone1-temperature').feature;
  assert.equal(zone.type, 'decimal', 'a room thermostat sensor');
});

test('feature names follow the language', () => {
  const s = heishamonSnapshot();
  const name = (language, key) =>
    featureSpecs(s, language).find((spec) => spec.key === key).feature.name;
  assert.equal(name('en', 'tank-setpoint'), 'Hot water setpoint');
  assert.equal(name('fr', 'tank-setpoint'), 'Consigne eau chaude');
  assert.equal(name('fr', 'zone1-heat-setpoint'), 'Décalage (courbe) chauffage zone 1');
  const modes = featureSpecs(s, 'fr').find((spec) => spec.key === 'mode').feature;
  assert.deepEqual(
    modes.supported_options.map((o) => o.label),
    ['Arrêt', 'Chauffage', 'Refroidissement', 'Auto'],
  );
});

test('a value not known now is not sent; the error text', () => {
  const s = parseStatus(cloud.statusHeatOnlyError(), { guid: cloud.GUID_2 });
  const ids = { device: 'ext:x:aquarea:g', feature: (k) => `ext:x:aquarea:g:${k}` };
  const { readers } = buildDevice(ids, s, { language: 'en', source: 'cloud' });
  const states = Object.fromEntries(
    statesOf(readers, s).map(({ featureId, value }) => [featureId.split(':').pop(), value]),
  );
  assert.equal(states['zone1-temperature'], undefined, '126: no reading');
  assert.deepEqual(states.error, { text: 'H62' });
  assert.deepEqual(states['powerful-mode'], { text: '1' });
  assert.deepEqual(states['tank-heating'], { state: 1 });
});
