import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseHeishamonUrl, parseTopics } from '../src/config.js';

test('the HeishaMon address: a broker or the board', () => {
  assert.deepEqual(parseHeishamonUrl('192.168.1.10'), {
    kind: 'mqtt',
    url: 'mqtt://192.168.1.10',
    host: '192.168.1.10',
  });
  assert.deepEqual(parseHeishamonUrl('mqtts://broker.lan:8883'), {
    kind: 'mqtt',
    url: 'mqtts://broker.lan:8883',
    host: 'broker.lan-8883',
  });
  assert.deepEqual(parseHeishamonUrl('http://192.168.1.30/json'), {
    kind: 'http',
    url: 'http://192.168.1.30',
    host: '192.168.1.30',
  });
  assert.deepEqual(parseHeishamonUrl(''), { error: 'empty' });
  assert.deepEqual(parseHeishamonUrl('ftp://x'), { error: 'invalid' });
  assert.deepEqual(parseHeishamonUrl('mqtt://user:pw@broker'), { error: 'credentials' });
});

test('the base topics: one or several, never a wildcard', () => {
  assert.deepEqual(parseTopics(''), ['panasonic_heat_pump']);
  assert.deepEqual(parseTopics(' /pac1/ , pac2,pac2 '), ['pac1', 'pac2']);
  assert.deepEqual(parseTopics('pac/#'), ['panasonic_heat_pump']);
});

test('the defaults; nothing filled: nothing to start', () => {
  const c = normalizeConfig();
  assert.equal(c.source, null);
  assert.equal(c.error, 'empty');
  assert.equal(c.cloud.interval, DEFAULTS.cloud_interval);
  assert.equal(c.sensorInterval, 30);
  assert.equal(c.language, 'fr');
  assert.deepEqual(c.heishamon.topics, ['panasonic_heat_pump']);
});

test('the source: the filled section; both filled, the "prefer local" switch decides', () => {
  const cloud = { panasonic_id: ' a@b.c ', panasonic_password: 'p' };
  const local = { heishamon_url: 'mqtt://broker' };
  assert.equal(normalizeConfig(cloud).source, 'cloud');
  assert.equal(normalizeConfig(cloud).cloud.username, 'a@b.c');
  assert.equal(normalizeConfig(local).source, 'heishamon');
  assert.equal(normalizeConfig({ ...cloud, ...local }).source, 'heishamon');
  assert.equal(normalizeConfig({ ...cloud, ...local, GLADYS_PREFER_LOCAL: false }).source, 'cloud');
  assert.equal(normalizeConfig({ ...local, GLADYS_PREFER_LOCAL: false }).source, 'heishamon');
  assert.equal(normalizeConfig({ panasonic_id: 'a@b.c' }).error, 'cloud-incomplete');
  const bad = normalizeConfig({ heishamon_url: 'ftp://x' });
  assert.deepEqual([bad.source, bad.error], ['heishamon', 'invalid']);
});

test('numbers are bounded, unknown values fall back', () => {
  const c = normalizeConfig({
    cloud_interval: 5,
    http_interval: 'abc',
    sensor_interval: 9999,
    language: 'de',
    verify_certificate: false,
    app_version: ' 4.3.0 ',
  });
  assert.equal(c.cloud.interval, 60);
  assert.equal(c.heishamon.interval, 30);
  assert.equal(c.sensorInterval, 600);
  assert.equal(c.language, 'fr');
  assert.equal(c.heishamon.verifyCertificate, false);
  assert.equal(c.cloud.appVersion, '4.3.0');
});
