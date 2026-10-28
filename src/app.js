// -----------------------------------------------------------------------------
// The integration: one source of heat pump snapshots (Aquarea Smart Cloud or
// HeishaMon, src/config.js picks it), the Gladys devices built from them
// (src/model.js), their states, the daily consumption of the cloud, the
// energy index of HeishaMon, the error scene trigger, the badges, and the
// commands sent back. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { CloudSource } from './cloud/source.js';
import { normalizeConfig } from './config.js';
import { DEVICE_TYPES, LIMITS, SCENE_TRIGGERS } from './constants.js';
import { EnergyCounter } from './energy.js';
import { HeishamonSource } from './heishamon/source.js';
import { T } from './i18n.js';
import { buildDevice, statesOf } from './model.js';
import { StatePublisher } from './publisher.js';
import { createStore } from './store.js';

/** The feature key of a feature external id (`<device>:<key>`). */
export const keyOf = (featureId) => featureId.slice(featureId.lastIndexOf(':') + 1);
const cut = (text, max) => String(text ?? '').slice(0, max);

/** The source of a configuration. */
export function createSource(config, deps) {
  return config.source === 'cloud'
    ? new CloudSource({ config, ...deps })
    : new HeishamonSource({ config, ...deps });
}

export class AquareaApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'aquarea' }),
    store,
    makeSource = createSource,
    sourceDeps = {},
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store ?? createStore({ logger });
    this.makeSource = makeSource;
    this.sourceDeps = sourceDeps;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    this.source = null;
    /** platform id -> last snapshot */
    this.snapshots = new Map();
    /** platform ids the source lists now (the account, the base topics heard) */
    this.listed = new Set();
    /** device id -> { platformId, readers } */
    this.devices = new Map();
    /** feature id -> platform id (commands) */
    this.owners = new Map();
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.createdFeatures = new Set();
    this.createdDevices = new Set();
    /** device id -> last badge published (JSON) */
    this.transports = new Map();
    /** device id -> last error code seen (null: none) */
    this.errors = new Map();
    /** feature id -> finished days not yet accepted by Gladys */
    this.pendingDays = new Map();
    this.sceneWindow = [];
    this.publishedDevices = undefined;
    this.rebuildTimer = undefined;
    this.lastStatus = undefined;
    this.generation = 0;
    this.energy = new EnergyCounter({ store: this.store, now });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw ?? this.gladys.config ?? {});
    this.refreshCreated();
    if (this.config.error && !this.config.source) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    if (this.config.error) {
      await this.setStatus(false, T.heishamon.badUrl(this.config.error));
      return;
    }
    this.publisher.configure({ intervalSeconds: this.config.sensorInterval, throttled: new Set() });
    this.publisher.start();
    const source = this.makeSource(this.config, {
      store: this.store,
      logger: this.logger,
      now: this.now,
      timers: this.timers,
      hooks: this.hooksFor(generation),
      ...this.sourceDeps,
    });
    this.source = source;
    this.logger.info(
      `Starting with ${this.config.source === 'cloud' ? 'Aquarea Smart Cloud' : `HeishaMon (${this.config.heishamon.kind})`}`,
    );
    await source.start();
  }

  stop() {
    this.generation += 1;
    this.source?.stop();
    this.source = null;
    this.publisher.stop();
    this.timers.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = undefined;
    this.energy.save();
    this.listed.clear();
  }

  /** The callbacks of a source, ignored once the app restarted. */
  hooksFor(generation) {
    const live = () => generation === this.generation;
    return {
      snapshot: async (snapshot) => {
        if (live()) {
          this.onSnapshot(snapshot);
        }
      },
      devices: async (platformIds) => {
        if (live()) {
          this.listed = new Set(platformIds);
          this.scheduleRebuild();
        }
      },
      consumption: async (platformId, days) => {
        if (live()) {
          await this.onConsumption(platformId, days);
        }
      },
      status: async (connected, message) => {
        if (live()) {
          await this.setStatus(connected, message);
        }
      },
      transports: async () => {
        if (live()) {
          await this.publishAllTransports();
        }
      },
    };
  }

  get deviceType() {
    return this.config.source === 'cloud' ? DEVICE_TYPES.CLOUD : DEVICE_TYPES.HEISHAMON;
  }

  idsOf(platformId) {
    return this.gladys.externalIds(this.deviceType, platformId);
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Snapshots -----------------------------------------------------------------

  onSnapshot(snapshot) {
    const ids = this.idsOf(snapshot.platformId);
    if (snapshot.consumedPower !== undefined) {
      snapshot.consumedEnergy = this.energy.add(ids.device, snapshot.consumedPower, this.now());
    }
    const previous = this.snapshots.get(snapshot.platformId);
    this.snapshots.set(snapshot.platformId, snapshot);
    if (snapshot.name === undefined && previous?.name) {
      snapshot.name = previous.name;
    }
    const built = this.build(snapshot);
    const entry = this.devices.get(ids.device);
    if (!entry || entry.shape !== built.shape) {
      this.scheduleRebuild();
    }
    for (const { featureId, value } of statesOf(built.readers, snapshot)) {
      this.record(featureId, value);
    }
    this.checkError(ids.device, snapshot);
  }

  build(snapshot) {
    const ids = this.idsOf(snapshot.platformId);
    const { device, readers } = buildDevice(ids, snapshot, {
      language: this.config.language,
      source: this.config.source,
      tankCap: this.config.tankCap,
    });
    if (!device.name || device.name === T.names(this.config.language).device) {
      device.name = this.defaultName(snapshot);
    }
    return { device, readers, shape: JSON.stringify(device) };
  }

  /** "Aquarea heat pump", "Pompe à chaleur Aquarea (panasonic_heat_pump_2)"… */
  defaultName(snapshot) {
    const base = T.names(this.config.language).device;
    const ids = this.config.source === 'cloud' ? [] : this.config.heishamon.topics;
    return ids.length > 1 || this.snapshots.size > 1 ? `${base} (${snapshot.platformId})` : base;
  }

  /** Keeps the value, and sends it when the feature exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.createdFeatures.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  /** A new error code (not the one seen at the connection): the scene trigger. */
  checkError(deviceId, snapshot) {
    if (snapshot.error === undefined) {
      return;
    }
    const code = snapshot.error.code ?? null;
    const known = this.errors.has(deviceId);
    const previous = this.errors.get(deviceId);
    this.errors.set(deviceId, code);
    if (!known || code === null || code === previous) {
      return;
    }
    this.logger.warn(`${snapshot.name || snapshot.platformId}: error ${code}`);
    if (!this.createdDevices.has(deviceId)) {
      return;
    }
    const now = this.now();
    this.sceneWindow = this.sceneWindow.filter((t) => now - t < 60_000);
    if (this.sceneWindow.length >= LIMITS.sceneEventsPerMinute) {
      return;
    }
    this.sceneWindow.push(now);
    this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.ERROR, {
        device: deviceId,
        code: cut(code, 40),
        message: cut(snapshot.error.message, LIMITS.text),
        heat_pump: cut(snapshot.name || snapshot.platformId, 100),
      })
      .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
  }

  // --- Discovery -------------------------------------------------------------------

  /** Many values arrive at once (a connection): publish the list once they settled. */
  scheduleRebuild(ms = 1000) {
    if (this.rebuildTimer !== undefined) {
      return;
    }
    const generation = this.generation;
    this.rebuildTimer = this.timers.setTimeout(() => {
      this.rebuildTimer = undefined;
      if (generation === this.generation) {
        this.rebuild().catch((err) => this.logger.warn(`Discovery: ${err.message}`));
      }
    }, ms);
  }

  /** The heat pumps offered in Discovery: listed by the source now, or created by the user. */
  async rebuild({ force = false } = {}) {
    const devices = [];
    const throttled = new Set();
    this.devices.clear();
    this.owners.clear();
    for (const snapshot of this.snapshots.values()) {
      const ids = this.idsOf(snapshot.platformId);
      if (!this.listed.has(snapshot.platformId) && !this.createdDevices.has(ids.device)) {
        continue;
      }
      if (devices.length >= LIMITS.devices) {
        break;
      }
      const built = this.build(snapshot);
      devices.push(built.device);
      this.devices.set(ids.device, { platformId: snapshot.platformId, shape: built.shape });
      for (const reader of built.readers) {
        this.owners.set(reader.featureId, snapshot.platformId);
        if (reader.throttle) {
          throttled.add(reader.featureId);
        }
      }
    }
    this.publisher.configure({ intervalSeconds: this.config.sensorInterval, throttled });
    const json = JSON.stringify(devices);
    if (force || json !== this.publishedDevices) {
      await this.gladys.publishDiscoveredDevices(devices);
      this.publishedDevices = json;
      this.logger.info(`${devices.length} heat pump(s) offered in Discovery`);
    }
    await this.publishAllTransports();
  }

  /** The Scan button of the Discovery tab. */
  async rescan() {
    await this.source?.rescan();
    await this.rebuild({ force: true });
  }

  // --- Daily consumption (cloud) ------------------------------------------------------

  async onConsumption(platformId, days) {
    const featureId = this.idsOf(platformId).feature('daily-consumption');
    this.pendingDays.set(featureId, days);
    await this.flushConsumption(featureId);
  }

  /** Sends the finished days once the user created the heat pump (the core needs the feature). */
  async flushConsumption(featureId) {
    const days = this.pendingDays.get(featureId);
    if (!days || !this.createdFeatures.has(featureId)) {
      return;
    }
    try {
      const result = await this.gladys.publishEnergyConsumption(
        featureId,
        days.map(({ date, kwh }) => ({ date, kwh })),
      );
      this.pendingDays.delete(featureId);
      if (result?.changed_from) {
        this.logger.info(`Daily consumption updated from ${result.changed_from}`);
      }
    } catch (err) {
      // 404: the device is being created; the next hourly read sends them again.
      this.logger.warn(`Daily consumption refused: ${err.message}`);
    }
  }

  // --- Transport badges ------------------------------------------------------------

  transportOf(deviceId) {
    const entry = this.devices.get(deviceId);
    if (!this.source) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (!entry) {
      // Not read (yet), or a heat pump of the other connection.
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: true, message: T.badge.notRead };
    }
    return this.source.transportOf(entry.platformId);
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices) {
      const badge = this.transportOf(deviceId);
      const key = JSON.stringify(badge);
      if (this.transports.get(deviceId) !== key) {
        this.transports.set(deviceId, key);
        entries.push({ external_id: deviceId, ...badge });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user ---------------------------------------------------

  refreshCreated() {
    const devices = this.gladys.devices ?? [];
    this.createdDevices = new Set(devices.map((d) => d.external_id));
    this.createdFeatures = new Set(
      devices.flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
      if (this.pendingDays.has(f.external_id)) {
        await this.flushConsumption(f.external_id);
      }
    }
    await this.publishAllTransports();
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Commands ------------------------------------------------------------------

  async setValue(device, feature, value) {
    if (!this.source) {
      throw new Error('The integration is not configured');
    }
    const platformId = this.owners.get(feature.external_id);
    if (platformId === undefined) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    // The heat pump confirms the new value at its next report.
    await this.source.command(platformId, keyOf(feature.external_id), value);
  }

  // --- Configuration screen buttons --------------------------------------------------

  /** Reads the heat pumps with the saved configuration, without touching the running source. */
  async testConnection() {
    const config = this.config;
    if (!config.source) {
      return T.configError(config.error);
    }
    if (config.error) {
      return T.heishamon.badUrl(config.error);
    }
    const noop = async () => {};
    const source = this.makeSource(config, {
      store: this.store,
      logger: this.logger,
      now: this.now,
      timers: this.timers,
      hooks: { snapshot: noop, devices: noop, consumption: noop, status: noop, transports: noop },
      ...this.sourceDeps,
    });
    try {
      return await source.test();
    } finally {
      source.stop?.();
    }
  }

  /** The two-factor code of the Panasonic ID (cloud only). */
  async twoFactor(fields = {}) {
    if (this.config.source !== 'cloud' || !this.source) {
      return T.cloud.codeNotCloud;
    }
    return this.source.twoFactor(fields.code);
  }
}
