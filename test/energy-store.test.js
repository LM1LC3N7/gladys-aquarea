import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnergyCounter } from '../src/energy.js';
import { createStore, memoryStore } from '../src/store.js';

const MIN = 60_000;

test('the power held between two readings makes the index', () => {
  const counter = new EnergyCounter({ store: memoryStore(), now: () => 0 });
  assert.equal(counter.add('d', 1000, 0), 0);
  assert.equal(counter.add('d', 2000, 6 * MIN), 0.1);
  assert.equal(counter.add('d', 0, 9 * MIN), 0.2);
  assert.equal(counter.add('d', 0, 60 * MIN), 0.2, 'nothing consumed at 0 W');
});

test('a gap longer than 15 minutes is not counted; an unknown power stops the count', () => {
  const counter = new EnergyCounter({ store: memoryStore(), now: () => 0 });
  counter.add('d', 1000, 0);
  assert.equal(counter.add('d', 1000, 20 * MIN), 0, 'HeishaMon away');
  assert.equal(counter.add('d', null, 25 * MIN), 0.083);
  assert.equal(counter.add('d', 1000, 30 * MIN), 0.083, 'no power known before');
  counter.pause('d');
  assert.equal(counter.add('d', 1000, 35 * MIN), 0.083);
});

test('the index is saved at most every 5 minutes, and read back', () => {
  let now = 0;
  const store = memoryStore();
  const counter = new EnergyCounter({ store, now: () => now });
  counter.add('d', 3000, 0);
  now = MIN;
  counter.add('d', 3000, MIN);
  assert.equal(store.docs.get('energy'), undefined);
  now = 6 * MIN;
  counter.add('d', 3000, 6 * MIN);
  assert.deepEqual(store.docs.get('energy'), { totals: { d: 0.3 } });
  counter.save();
  const again = new EnergyCounter({ store, now: () => now });
  assert.equal(again.add('d', 0, 7 * MIN), 0.3);
});

test('a saved index that is not a number is dropped', () => {
  const store = memoryStore({ energy: { totals: { a: 'x', b: -1, c: 2.5 } } });
  const counter = new EnergyCounter({ store });
  assert.deepEqual([...counter.totals.entries()], [['c', 2.5]]);
});

test('the file store writes JSON documents in its folder, and survives a bad one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aquarea-'));
  try {
    const warnings = [];
    const store = createStore({ dir, logger: { warn: (m) => warnings.push(m) } });
    assert.equal(store.load('session'), undefined);
    store.save('session', { refreshToken: 'r' });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')), {
      refreshToken: 'r',
    });
    assert.deepEqual(store.load('session'), { refreshToken: 'r' });
    writeFileSync(join(dir, 'energy.json'), '{oops');
    assert.equal(store.load('energy'), undefined);
    assert.equal(warnings.length, 1);
    assert.throws(() => store.load('../etc/passwd'), /bad document name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
