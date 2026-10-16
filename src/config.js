// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
//
// Two ways to reach the heat pump, each filled in its own section:
//   - Aquarea Smart Cloud: the Panasonic ID of the Comfort Cloud / Aquarea
//     Smart Cloud app (CZ-TAW1 / CZ-TAW1B adapters);
//   - HeishaMon: the board on the CN-CNT port, read on the user's MQTT broker
//     (mqtt://...) or through its own web server (http://.../json).
// When both are filled, the "Prefer the local connection" switch of Gladys
// (GLADYS_PREFER_LOCAL, on by default) picks HeishaMon; off, the cloud.
// -----------------------------------------------------------------------------

import { CLOUD_INTERVAL, DEFAULT_TOPIC, HTTP_INTERVAL, SENSOR_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  panasonic_id: '',
  panasonic_password: '',
  cloud_interval: CLOUD_INTERVAL.default,
  app_version: '',
  heishamon_url: '',
  heishamon_topic: DEFAULT_TOPIC,
  mqtt_username: '',
  mqtt_password: '',
  verify_certificate: true,
  http_interval: HTTP_INTERVAL.default,
  sensor_interval: SENSOR_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['en', 'fr'];

const MQTT_SCHEMES = ['mqtt:', 'mqtts:', 'ws:', 'wss:', 'tcp:', 'ssl:'];
const HTTP_SCHEMES = ['http:', 'https:'];

/**
 * Where HeishaMon is read: an MQTT broker ("192.168.1.10" -> "mqtt://192.168.1.10"),
 * or the board itself ("http://192.168.1.30" -> its `/json` page).
 * @returns {{ kind: 'mqtt' | 'http', url: string, host: string } | { error: string }}
 */
export function parseHeishamonUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `mqtt://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  const kind = MQTT_SCHEMES.includes(url.protocol)
    ? 'mqtt'
    : HTTP_SCHEMES.includes(url.protocol)
      ? 'http'
      : undefined;
  if (!kind || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // Credentials belong to their own fields (the secret one is never shown again).
    return { error: 'credentials' };
  }
  // `host` names the board in the device external id: no colon in it.
  const host = url.port ? `${url.hostname}-${url.port}` : url.hostname;
  if (kind === 'http') {
    // The board serves /json and /command at its root: keep the origin only.
    return { kind, url: url.origin, host };
  }
  return { kind, url: url.toString().replace(/\/$/, ''), host };
}

/**
 * The base topics of HeishaMon ("panasonic_heat_pump", one per heat pump,
 * comma-separated). No wildcard, no leading or trailing slash.
 */
export function parseTopics(raw) {
  const topics = String(raw ?? '')
    .split(',')
    .map((t) => t.trim().replace(/^\/+|\/+$/g, ''))
    .filter((t) => t !== '' && !/[+#]/.test(t));
  return topics.length > 0 ? [...new Set(topics)] : [DEFAULT_TOPIC];
}

const clamp = (raw, { min, max, default: fallback }) => {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
};

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const cloud = {
    username: String(c.panasonic_id ?? '').trim(),
    password: String(c.panasonic_password ?? ''),
    interval: clamp(c.cloud_interval, CLOUD_INTERVAL),
    appVersion: String(c.app_version ?? '').trim(),
  };
  const server = parseHeishamonUrl(c.heishamon_url);
  const heishamon = {
    kind: server.kind,
    url: server.url,
    host: server.host,
    urlError: server.error,
    topics: parseTopics(c.heishamon_topic),
    username: String(c.mqtt_username ?? '').trim(),
    password: String(c.mqtt_password ?? ''),
    verifyCertificate: c.verify_certificate !== false,
    interval: clamp(c.http_interval, HTTP_INTERVAL),
  };
  const cloudReady = cloud.username !== '' && cloud.password !== '';
  const heishamonFilled = server.error !== 'empty';
  const preferLocal = c.GLADYS_PREFER_LOCAL !== false;
  let source = null;
  let error;
  if (heishamonFilled && (preferLocal || !cloudReady)) {
    source = 'heishamon';
    error = server.error;
  } else if (cloudReady) {
    source = 'cloud';
  } else if (cloud.username !== '' || cloud.password !== '') {
    error = 'cloud-incomplete';
  } else {
    error = 'empty';
  }
  return {
    source,
    error,
    preferLocal,
    cloud,
    heishamon,
    sensorInterval: clamp(c.sensor_interval, SENSOR_INTERVAL),
    language: LANGUAGES.includes(c.language) ? c.language : DEFAULTS.language,
  };
}
