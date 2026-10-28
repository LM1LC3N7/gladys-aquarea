// -----------------------------------------------------------------------------
// HeishaMon as a source of heat pump snapshots: one HeishaMon board per base
// topic, read on the user's MQTT broker, or one board read through its web
// server (`/json` every `http_interval` seconds, `/command?...`).
//
// HeishaMon retains its values: on subscription the broker hands every last
// value at once, then HeishaMon publishes the ones that change (every read of
// the heat pump, 5 s by default) and all of them every 5 minutes.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import mqtt from 'mqtt';
import { LIMITS, TIMINGS } from '../constants.js';
import { T } from '../i18n.js';
import { HeishamonState } from './state.js';

/** MQTT 3.1.1 / 5 CONNACK refusals worth a precise message. */
export const REFUSALS = {
  1: 'unacceptable protocol version',
  2: 'identifier rejected',
  3: 'server unavailable',
  4: 'bad user name or password',
  5: 'not authorized',
  134: 'bad user name or password',
  135: 'not authorized',
};

export const isRefusal = (err) => err?.code !== undefined && [4, 5, 134, 135].includes(err.code);

/** A readable reason for a connection error (never the password). */
export function errorReason(err) {
  if (!err) {
    return 'unknown error';
  }
  if (err.code !== undefined && REFUSALS[err.code]) {
    return REFUSALS[err.code];
  }
  if (typeof err.code === 'string') {
    return `${err.code}${err.address ? ` ${err.address}${err.port ? `:${err.port}` : ''}` : ''}`;
  }
  return String(err.message ?? err).slice(0, 200);
}

export function connectBroker(config, { connect = mqtt.connect } = {}) {
  return connect(config.url, {
    username: config.username || undefined,
    password: config.password || undefined,
    // A random client id: two instances (a test and a restart) never kick each other out.
    clientId: `gladys_aquarea_${randomBytes(4).toString('hex')}`,
    clean: true,
    keepalive: 60,
    connectTimeout: TIMINGS.connectTimeout,
    reconnectPeriod: TIMINGS.reconnectPeriod,
    rejectUnauthorized: config.verifyCertificate,
    protocolVersion: 4,
    resubscribe: false,
  });
}

/** GET a URL of the board: its text, within a timeout and a size limit. */
export async function httpGet(url, { timeout = TIMINGS.requestTimeout } = {}) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'error' });
  } catch (err) {
    const reason = err?.cause?.code ?? (err?.name === 'TimeoutError' ? 'timeout' : err?.name);
    throw new Error(`${new URL(url).host} unreachable (${reason ?? 'error'})`, { cause: err });
  }
  const text = await response.text();
  if (text.length > LIMITS.responseBytes) {
    throw new Error('answer too large');
  }
  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

/**
 * The values of the `/json` page: `[{ group, name, value }]` from its
 * "heatpump" and "heatpump extra" lists (`{ Topic, Name, Value, Description }`).
 */
export function parseJsonPage(text) {
  let page;
  try {
    page = JSON.parse(text);
  } catch {
    throw new Error('not the /json page of HeishaMon');
  }
  if (!page || !Array.isArray(page.heatpump)) {
    throw new Error('not the /json page of HeishaMon');
  }
  const values = [];
  for (const [key, group] of [
    ['heatpump', 'main'],
    ['heatpump extra', 'extra'],
  ]) {
    for (const entry of Array.isArray(page[key]) ? page[key] : []) {
      if (entry && typeof entry.Name === 'string' && entry.Value !== undefined) {
        values.push({ group, name: entry.Name, value: String(entry.Value) });
      }
    }
  }
  return values;
}

export class HeishamonSource {
  /**
   * @param {object} options
   * @param {ReturnType<import('../config.js').normalizeConfig>} options.config
   * @param {object} options.hooks snapshot, devices, status, transports
   * @param {Function} [options.connect] mqtt.connect (tests)
   * @param {Function} [options.get] httpGet (tests)
   */
  constructor({
    config,
    hooks,
    logger,
    connect = mqtt.connect,
    get = httpGet,
    now = Date.now,
    timers = globalThis,
  }) {
    this.config = config;
    this.settings = config.heishamon;
    this.hooks = hooks;
    this.logger = logger;
    this.connectImpl = connect;
    this.get = get;
    this.now = now;
    this.timers = timers;
    this.transport = DEVICE_TRANSPORTS.LOCAL;
    this.kind = this.settings.kind;
    /** platform id -> HeishamonState */
    this.states = new Map();
    this.client = null;
    this.linkUp = false;
    this.linkError = undefined;
    this.generation = 0;
    this.pollTimer = undefined;
    this.staleTimer = undefined;
    this.emitTimers = new Map();
    /** platform id -> time of the last snapshot */
    this.lastEmit = new Map();
    this.announced = new Set();
    this.warned = new Set();
  }

  /** The platform ids: the base topics (MQTT), the board address (HTTP). */
  platformIds() {
    return this.kind === 'http' ? [this.settings.host] : this.settings.topics;
  }

  stateOf(platformId) {
    let state = this.states.get(platformId);
    if (!state) {
      state = new HeishamonState(platformId);
      this.states.set(platformId, state);
    }
    return state;
  }

  current(generation) {
    return generation === this.generation;
  }

  async start() {
    this.stop();
    const generation = this.generation;
    await this.hooks.status(false, T.heishamon.connecting(this.kind));
    this.staleTimer = this.timers.setInterval(() => {
      this.hooks.transports().catch(() => {});
      this.refreshStatus();
    }, 60_000);
    if (this.kind === 'http') {
      await this.pollHttp(generation);
    } else {
      this.startMqtt(generation);
    }
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.pollTimer);
    this.timers.clearInterval(this.staleTimer);
    for (const timer of this.emitTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.emitTimers.clear();
    this.pollTimer = undefined;
    this.staleTimer = undefined;
    if (this.client) {
      this.client.removeAllListeners?.();
      this.client.on?.('error', () => {});
      this.client.end(true);
      this.client = null;
    }
    this.linkUp = false;
  }

  // --- MQTT ------------------------------------------------------------------------

  startMqtt(generation) {
    const client = connectBroker(this.settings, { connect: this.connectImpl });
    this.client = client;
    const live = () => this.current(generation) && this.client === client;
    client.on('connect', () => {
      if (!live()) {
        return;
      }
      const filters = this.settings.topics.flatMap((base) => [
        `${base}/main/+`,
        `${base}/extra/+`,
        `${base}/LWT`,
      ]);
      client.subscribe(filters, { qos: 0 }, (err) => {
        if (err) {
          this.logger.warn(`Subscription failed: ${err.message}`);
        }
      });
      this.linkUp = true;
      this.linkError = undefined;
      this.logger.info(`Connected to the MQTT broker ${this.settings.url}`);
      this.refreshStatus();
      this.hooks.transports().catch(() => {});
    });
    client.on('message', (topic, payload) => {
      if (live()) {
        this.onMessage(topic, payload);
      }
    });
    client.on('error', (err) => {
      if (!live()) {
        return;
      }
      const reason = errorReason(err);
      this.logger.warn(`MQTT broker: ${reason}`);
      this.linkUp = false;
      this.linkError = { reason, refused: isRefusal(err) };
      this.refreshStatus();
    });
    client.on('close', () => {
      if (!live()) {
        return;
      }
      if (this.linkUp) {
        this.linkUp = false;
        this.linkError = { reason: 'connection lost', refused: false };
        this.refreshStatus();
      }
      this.hooks.transports().catch(() => {});
    });
  }

  /** `<base>/main/<Name>`, `<base>/extra/<Name>` or `<base>/LWT`. */
  onMessage(topic, payload) {
    if (payload?.length > LIMITS.payloadBytes) {
      return;
    }
    const base = this.settings.topics.find((b) => topic.startsWith(`${b}/`));
    if (!base) {
      return;
    }
    const rest = topic.slice(base.length + 1);
    const state = this.stateOf(base);
    if (rest === 'LWT') {
      const value = String(payload ?? '').trim();
      if (value !== state.lwt) {
        state.lwt = value;
        if (value.toLowerCase() === 'offline') {
          this.logger.warn(`HeishaMon ${base} is offline`);
        }
        this.refreshStatus();
        this.hooks.transports().catch(() => {});
      }
      return;
    }
    const [group, name, ...more] = rest.split('/');
    if (more.length > 0 || !name || (group !== 'main' && group !== 'extra')) {
      return;
    }
    const changed = state.apply(group, name, payload, this.now());
    // Unchanged values still prove the heat pump is read (the energy index
    // integrates the power between two snapshots): one snapshot a minute.
    if (changed || this.now() - (this.lastEmit.get(base) ?? -Infinity) >= 60_000) {
      this.emitSoon(base);
    }
  }

  /** A burst of values (the retained ones at the connection) makes one snapshot. */
  emitSoon(platformId) {
    if (this.emitTimers.has(platformId)) {
      return;
    }
    const generation = this.generation;
    this.emitTimers.set(
      platformId,
      this.timers.setTimeout(() => {
        this.emitTimers.delete(platformId);
        if (this.current(generation)) {
          this.emit(platformId).catch((err) => this.logger.warn(`HeishaMon: ${err.message}`));
        }
      }, 300),
    );
  }

  async emit(platformId) {
    const state = this.states.get(platformId);
    if (!state?.ready) {
      return;
    }
    this.lastEmit.set(platformId, this.now());
    if (!this.announced.has(platformId)) {
      this.announced.add(platformId);
      this.logger.info(
        `HeishaMon ${platformId}: heat pump ${state.main.get('Heat_Pump_Model') ?? ''}`,
      );
      await this.hooks.devices([...this.announced]);
      this.refreshStatus();
    }
    await this.hooks.snapshot(state.snapshot());
  }

  // --- HTTP ------------------------------------------------------------------------

  async pollHttp(generation) {
    const platformId = this.settings.host;
    try {
      const values = parseJsonPage(await this.get(`${this.settings.url}/json`));
      if (!this.current(generation)) {
        return;
      }
      const state = this.stateOf(platformId);
      for (const { group, name, value } of values) {
        state.apply(group, name, value, this.now());
      }
      state.lwt = 'Online';
      const wasUp = this.linkUp;
      this.linkUp = true;
      this.linkError = undefined;
      if (!wasUp) {
        this.logger.info(`Reading HeishaMon at ${this.settings.url}`);
        this.hooks.transports().catch(() => {});
      }
      await this.emit(platformId);
      this.refreshStatus();
    } catch (err) {
      if (!this.current(generation)) {
        return;
      }
      if (this.linkUp || !this.warned.has(err.message)) {
        this.logger.warn(`HeishaMon ${this.settings.url}: ${err.message}`);
        this.warned.add(err.message);
      }
      this.linkUp = false;
      this.linkError = { reason: err.message, refused: false };
      this.refreshStatus();
      this.hooks.transports().catch(() => {});
    }
    if (this.current(generation)) {
      this.timers.clearTimeout(this.pollTimer);
      this.pollTimer = this.timers.setTimeout(
        () => this.pollHttp(generation).catch(() => {}),
        this.settings.interval * 1000,
      );
    }
  }

  // --- Status, badges, commands ------------------------------------------------------

  refreshStatus() {
    this.hooks.status(this.linkUp, this.statusMessage()).catch(() => {});
  }

  statusMessage() {
    if (!this.linkUp) {
      const { reason, refused } = this.linkError ?? { reason: 'connecting', refused: false };
      return refused ? T.heishamon.refused(reason) : T.heishamon.unreachable(this.kind, reason);
    }
    const offline = [...this.states.values()].filter((s) => s.lwt?.toLowerCase() === 'offline');
    if (offline.length > 0) {
      return T.heishamon.offline(offline.map((s) => s.platformId));
    }
    if (this.announced.size === 0) {
      return T.heishamon.waiting(this.kind, this.settings.topics);
    }
    return T.heishamon.connected(this.kind, this.announced.size);
  }

  transportOf(platformId) {
    if (!this.linkUp) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const state = this.states.get(platformId);
    if (!state || state.lwt?.toLowerCase() === 'offline') {
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: T.badge.heishamonOffline,
      };
    }
    if (state.lastAt === undefined || this.now() - state.lastAt > TIMINGS.heishamonStale) {
      return { transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message: T.badge.stale };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  async command(platformId, key, value) {
    if (!this.linkUp) {
      throw new Error(
        this.kind === 'http' ? 'HeishaMon is unreachable' : 'MQTT broker unreachable',
      );
    }
    const state = this.states.get(platformId);
    if (!state?.ready) {
      throw new Error('This heat pump has not been read yet');
    }
    const commands = state.commands(key, value, { tankCap: this.config.tankCap });
    if (commands.length === 0) {
      return;
    }
    if (this.kind === 'http') {
      const query = commands
        .map(({ name, value: v }) => `${encodeURIComponent(name)}=${encodeURIComponent(String(v))}`)
        .join('&');
      await this.get(`${this.settings.url}/command?${query}`);
      // The next read shows the result.
      this.timers.clearTimeout(this.pollTimer);
      const generation = this.generation;
      this.pollTimer = this.timers.setTimeout(
        () => this.pollHttp(generation).catch(() => {}),
        5000,
      );
    } else {
      for (const { name, value: v } of commands) {
        await new Promise((resolve, reject) =>
          this.client.publish(`${platformId}/commands/${name}`, String(v), { qos: 0 }, (err) =>
            err ? reject(err) : resolve(),
          ),
        );
      }
    }
    this.logger.debug(
      `HeishaMon ${platformId}: ${commands.map((c) => `${c.name}=${c.value}`).join(' ')}`,
    );
  }

  async rescan() {
    for (const platformId of this.announced) {
      await this.emit(platformId);
    }
  }

  /** The connection test: the broker (or the board) with the saved configuration. */
  async test() {
    if (this.kind === 'http') {
      try {
        const values = parseJsonPage(await this.get(`${this.settings.url}/json`));
        const state = new HeishamonState(this.settings.host);
        for (const { group, name, value } of values) {
          state.apply(group, name, value, this.now());
        }
        return T.heishamon.testOk('http', [state.snapshot()]);
      } catch (err) {
        return T.heishamon.unreachable('http', err.message);
      }
    }
    return new Promise((resolve) => {
      const client = connectBroker(this.settings, { connect: this.connectImpl });
      const states = new Map();
      let done = false;
      let timer;
      const finish = (message) => {
        if (done) {
          return;
        }
        done = true;
        this.timers.clearTimeout(timer);
        client.removeAllListeners?.();
        client.on?.('error', () => {});
        client.end(true);
        resolve(message);
      };
      const report = () => {
        const found = [...states.values()].filter((s) => s.ready).map((s) => s.snapshot());
        finish(
          found.length > 0
            ? T.heishamon.testOk('mqtt', found)
            : T.heishamon.testNothing(this.settings.topics, TIMINGS.testListen / 1000),
        );
      };
      timer = this.timers.setTimeout(
        () => finish(T.heishamon.unreachable('mqtt', 'no answer from the broker')),
        TIMINGS.connectTimeout,
      );
      client.on('connect', () => {
        client.subscribe(this.settings.topics.map((b) => `${b}/main/+`));
        // The retained values come at once; listen a little for a live HeishaMon too.
        this.timers.clearTimeout(timer);
        timer = this.timers.setTimeout(report, TIMINGS.testListen);
      });
      client.on('message', (topic, payload) => {
        const base = this.settings.topics.find((b) => topic.startsWith(`${b}/main/`));
        if (!base) {
          return;
        }
        let state = states.get(base);
        if (!state) {
          state = new HeishamonState(base);
          states.set(base, state);
        }
        state.apply('main', topic.slice(base.length + 6), payload, this.now());
      });
      client.on('error', (err) => {
        const reason = errorReason(err);
        finish(
          isRefusal(err) ? T.heishamon.refused(reason) : T.heishamon.unreachable('mqtt', reason),
        );
      });
    });
  }
}
