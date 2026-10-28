// -----------------------------------------------------------------------------
// Aquarea Smart Cloud as a source of heat pump snapshots.
//
// Lifecycle: start -> open (session, device list, one status per heat pump)
// -> a status read per heat pump every `cloud_interval` seconds, one request
// at a time, the consumption every hour, the device list every 6 hours ->
// on a failure, open again with a growing delay. Refused credentials and
// two-factor accounts are not retried on their own: the user changes the
// configuration or sends the code with the button.
//
// Polite polling: Panasonic counts the calls of an account. 2 minutes by
// default (the Home Assistant integration panasonic_cc reads the status
// every 2 minutes and the energy every 5); the consumption once an hour.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { LIMITS, TIMINGS } from '../constants.js';
import { T } from '../i18n.js';
import { AquareaApi, compactDate } from './api.js';
import { PanasonicError } from './http.js';
import { PanasonicSession } from './session.js';
import { commandBody, parseConsumption, parseStatus, statusOf } from './status.js';

/** Errors the user has to act on: no automatic retry. */
const USER_ACTION = ['credentials', 'mfa'];

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export class CloudSource {
  /**
   * @param {object} options
   * @param {ReturnType<import('../config.js').normalizeConfig>} options.config
   * @param {{ load: Function, save: Function }} options.store
   * @param {object} options.hooks snapshot, devices, consumption, status, transports
   * @param {Function} [options.request] createHttp() request (tests)
   */
  constructor({
    config,
    store,
    hooks,
    logger,
    request,
    now = Date.now,
    timers = globalThis,
    sleep,
  }) {
    this.config = config;
    this.store = store;
    this.hooks = hooks;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.timers = timers;
    this.sleep = sleep;
    this.transport = DEVICE_TRANSPORTS.CLOUD;
    this.session = this.newSession();
    this.api = new AquareaApi(this.session, { now });
    /** guid -> { guid, name, model } */
    this.devices = new Map();
    /** guid -> last status object (the commands resend parts of it) */
    this.raw = new Map();
    /** guid -> cached polls left (the adapter did not answer live) */
    this.cached = new Map();
    /** guid -> the reason the last status read failed */
    this.deviceErrors = new Map();
    this.online = false;
    this.failures = 0;
    this.lastError = undefined;
    this.generation = 0;
    this.pollTimer = undefined;
    this.consumptionTimer = undefined;
    this.echoTimers = new Map();
    this.devicesReadAt = 0;
  }

  newSession() {
    const { username, password, appVersion } = this.config.cloud;
    return new PanasonicSession({
      username,
      password,
      appVersion,
      session: this.store.load('session') ?? {},
      save: (session) => this.store.save('session', session),
      request: this.request,
      now: this.now,
      ...(this.sleep ? { sleep: this.sleep } : {}),
    });
  }

  current(generation) {
    return generation === this.generation;
  }

  async start() {
    this.stop();
    await this.hooks.status(false, T.cloud.connecting);
    await this.open(this.generation);
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.pollTimer);
    this.timers.clearTimeout(this.consumptionTimer);
    for (const timer of this.echoTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.echoTimers.clear();
    this.pollTimer = undefined;
    this.consumptionTimer = undefined;
    this.online = false;
  }

  schedule(generation, ms, fn) {
    this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = this.timers.setTimeout(() => {
      this.pollTimer = undefined;
      if (this.current(generation)) {
        fn().catch((err) => this.logger.error(`Aquarea loop: ${err.message}`));
      }
    }, ms);
  }

  // --- Connection ----------------------------------------------------------------

  async open(generation) {
    try {
      await this.readDevices(generation);
      if (!this.current(generation)) {
        return;
      }
      await this.pollAll(generation);
      if (!this.current(generation)) {
        return;
      }
      this.online = true;
      this.failures = 0;
      this.lastError = undefined;
      this.logger.info(`Connected to Aquarea Smart Cloud: ${this.devices.size} heat pump(s)`);
      await this.hooks.status(true, this.statusMessage());
      await this.hooks.transports();
      this.schedule(generation, this.config.cloud.interval * 1000, () => this.poll(generation));
      this.scheduleConsumption(generation, 10_000);
    } catch (err) {
      await this.fail(generation, err);
    }
  }

  statusMessage() {
    if (this.devices.size === 0) {
      return T.cloud.noDevice;
    }
    return T.cloud.connected(this.devices.size, this.cached.size > 0);
  }

  async fail(generation, err) {
    if (!this.current(generation)) {
      return;
    }
    this.online = false;
    this.failures += 1;
    this.lastError = err;
    this.timers.clearTimeout(this.consumptionTimer);
    if (err instanceof PanasonicError) {
      this.logger.warn(`Aquarea Smart Cloud: ${err.message}`);
    } else {
      this.logger.error('Aquarea Smart Cloud: unexpected failure', err);
    }
    await this.hooks.status(false, T.cloud.failure(err));
    await this.hooks.transports();
    if (USER_ACTION.includes(err?.kind)) {
      return; // a new configuration, or the two-factor button, starts again
    }
    const delay =
      err?.kind === 'agreement' || err?.kind === 'version'
        ? TIMINGS.authRetry
        : Math.min(TIMINGS.retryMax, TIMINGS.retryMin * 2 ** (this.failures - 1));
    this.schedule(generation, delay, () => this.open(generation));
  }

  async readDevices(generation) {
    const devices = (await this.api.devices()).slice(0, LIMITS.devices);
    if (!this.current(generation)) {
      return;
    }
    this.devices = new Map(devices.map((d) => [d.guid, d]));
    this.devicesReadAt = this.now();
    for (const map of [this.raw, this.cached, this.deviceErrors]) {
      for (const guid of map.keys()) {
        if (!this.devices.has(guid)) {
          map.delete(guid);
        }
      }
    }
    await this.hooks.devices([...this.devices.keys()]);
  }

  // --- Status reads -------------------------------------------------------------------

  async poll(generation) {
    try {
      if (this.now() - this.devicesReadAt >= TIMINGS.cloudDevicesRefresh) {
        await this.readDevices(generation);
      }
      await this.pollAll(generation);
    } catch (err) {
      await this.fail(generation, err);
      return;
    }
    if (!this.current(generation)) {
      return;
    }
    await this.hooks.status(true, this.statusMessage());
    await this.hooks.transports();
    this.schedule(generation, this.config.cloud.interval * 1000, () => this.poll(generation));
  }

  async pollAll(generation) {
    for (const guid of this.devices.keys()) {
      if (!this.current(generation)) {
        return;
      }
      await this.pollOne(guid);
    }
  }

  /**
   * One status read: live from the adapter, or the cloud copy for a while
   * after the adapter did not answer. A heat pump that cannot be read is
   * marked (badge), the others go on; a session or network failure is thrown.
   */
  async pollOne(guid) {
    const device = this.devices.get(guid);
    if (!device) {
      return;
    }
    let answer;
    const left = this.cached.get(guid) ?? 0;
    try {
      if (left > 0) {
        this.cached.set(guid, left - 1);
        answer = await this.api.status(guid, { live: false });
      } else {
        try {
          answer = await this.api.status(guid, { live: true });
          this.cached.delete(guid);
        } catch (err) {
          if (!isDeviceFailure(err)) {
            throw err;
          }
          this.logger.warn(`${device.name || guid}: no live status (${err.message}), cloud copy`);
          this.cached.set(guid, TIMINGS.cachedPolls);
          answer = await this.api.status(guid, { live: false });
        }
      }
    } catch (err) {
      if (!isDeviceFailure(err)) {
        throw err;
      }
      this.deviceErrors.set(guid, err.message);
      this.logger.warn(`${device.name || guid}: status unavailable (${err.message})`);
      return;
    }
    this.deviceErrors.delete(guid);
    const raw = statusOf(answer);
    this.raw.set(guid, raw);
    await this.hooks.snapshot(parseStatus(answer, device));
  }

  /** After a command: read that heat pump again soon, outside the regular pace. */
  echo(guid) {
    const generation = this.generation;
    this.timers.clearTimeout(this.echoTimers.get(guid));
    this.echoTimers.set(
      guid,
      this.timers.setTimeout(() => {
        this.echoTimers.delete(guid);
        if (this.current(generation) && this.online) {
          this.pollOne(guid)
            .then(() => this.hooks.transports())
            .catch((err) => this.logger.warn(`Status after the command: ${err.message}`));
        }
      }, TIMINGS.cloudCommandEcho),
    );
  }

  // --- Consumption ------------------------------------------------------------------

  scheduleConsumption(generation, ms) {
    this.timers.clearTimeout(this.consumptionTimer);
    this.consumptionTimer = this.timers.setTimeout(() => {
      this.consumptionTimer = undefined;
      if (!this.current(generation) || !this.online) {
        return;
      }
      this.readConsumption(generation)
        .catch((err) => this.logger.warn(`Aquarea consumption: ${err.message}`))
        .finally(() => {
          if (this.current(generation) && !this.consumptionTimer) {
            this.scheduleConsumption(generation, TIMINGS.consumptionRefresh);
          }
        });
    }, ms);
  }

  /** The finished days of this month (and of the last one, the first two days of a month). */
  async readConsumption(generation) {
    const now = new Date(this.now());
    const today = isoDate(now);
    const months = [now];
    if (now.getDate() <= 2) {
      months.push(new Date(now.getFullYear(), now.getMonth(), 0));
    }
    for (const guid of this.devices.keys()) {
      const days = [];
      for (const date of months) {
        if (!this.current(generation)) {
          return;
        }
        try {
          days.push(...parseConsumption(await this.api.consumption(guid, date), today));
        } catch (err) {
          if (!isDeviceFailure(err)) {
            throw err;
          }
          this.logger.warn(`Consumption of ${compactDate(date).slice(0, 6)}: ${err.message}`);
        }
      }
      if (days.length > 0) {
        await this.hooks.consumption(guid, days);
      }
    }
  }

  // --- Commands, badges, buttons -------------------------------------------------------

  async command(guid, key, value) {
    if (!this.online) {
      throw new Error('Aquarea Smart Cloud is not connected');
    }
    const raw = this.raw.get(guid);
    if (!raw) {
      throw new Error('This heat pump has not been read yet');
    }
    const body = commandBody(key, value, raw, { tankCap: this.config.tankCap });
    await this.api.control(guid, body);
    this.logger.debug(`Aquarea command for ${key}: ${Object.keys(body).join(', ')}`);
    this.echo(guid);
  }

  transportOf(guid) {
    if (!this.online) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (!this.devices.has(guid)) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: true, message: T.badge.gone };
    }
    if (this.deviceErrors.has(guid)) {
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: T.badge.adapterOffline,
      };
    }
    if ((this.cached.get(guid) ?? 0) > 0) {
      return { transport: DEVICE_TRANSPORTS.CLOUD, degraded: true, message: T.badge.cached };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async rescan() {
    if (!this.online) {
      return;
    }
    const generation = this.generation;
    await this.readDevices(generation);
    await this.pollAll(generation);
    await this.hooks.transports();
  }

  /** The two-factor code of the authenticator application: a login with it, then start again. */
  async twoFactor(code) {
    const text = String(code ?? '').replace(/\s+/g, '');
    if (!/^\d{6,8}$/.test(text)) {
      return T.cloud.codeFormat;
    }
    try {
      await this.session.login(text);
    } catch (err) {
      return T.cloud.failure(err);
    }
    this.stop();
    await this.open(this.generation);
    return T.cloud.codeAccepted;
  }

  /** The connection test: the saved session (or a login), the heat pumps, a cloud status each. */
  async test() {
    const session = this.newSession();
    const api = new AquareaApi(session, { now: this.now });
    try {
      const devices = await api.devices();
      const lines = [];
      for (const device of devices.slice(0, 5)) {
        try {
          lines.push(parseStatus(await api.status(device.guid, { live: false }), device));
        } catch (err) {
          if (!isDeviceFailure(err)) {
            throw err;
          }
          lines.push({ name: device.name || device.guid, unreadable: true });
        }
      }
      return T.cloud.testOk(devices.length, lines);
    } catch (err) {
      return T.cloud.failure(err);
    }
  }
}

/** A failure of one heat pump (adapter offline, value refused), not of the session. */
function isDeviceFailure(err) {
  if (!(err instanceof PanasonicError)) {
    return false;
  }
  if (err.kind === 'device') {
    return true;
  }
  // The proxy answers 4xx/5xx when the adapter does not answer live.
  return err.kind === 'http' && err.status !== 401 && err.status !== 403;
}
