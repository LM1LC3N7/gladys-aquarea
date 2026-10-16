// -----------------------------------------------------------------------------
// The energy index of a heat pump read through HeishaMon: HeishaMon reports
// the electrical power (W), Gladys' energy dashboards want a cumulative index
// (kWh) whose deltas the core turns into 30-minute consumption and cost.
//
// The power is held until the next reading (HeishaMon publishes a value when
// it changes, and every value every 5 minutes): the index grows by the
// previous power times the time elapsed. Across a gap longer than
// `maxGap` (HeishaMon or the broker away) nothing is counted. The totals are
// kept in /data, so the index never goes back after a restart.
// -----------------------------------------------------------------------------

import { TIMINGS } from './constants.js';

const KWH_PER_WATT_MS = 1 / 3_600_000_000;

export class EnergyCounter {
  /**
   * @param {object} options
   * @param {{ load: Function, save: Function }} options.store
   * @param {() => number} [options.now]
   */
  constructor({
    store,
    now = Date.now,
    maxGap = TIMINGS.energyMaxGap,
    saveEvery = TIMINGS.energySave,
  }) {
    this.store = store;
    this.now = now;
    this.maxGap = maxGap;
    this.saveEvery = saveEvery;
    const saved = store.load('energy')?.totals ?? {};
    /** device id -> kWh */
    this.totals = new Map(
      Object.entries(saved).filter(
        ([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
      ),
    );
    /** device id -> { watts, at } */
    this.last = new Map();
    this.savedAt = now();
    this.dirty = false;
  }

  /**
   * A power reading. Returns the index (kWh, 3 decimals) after it.
   * @param {string} deviceId
   * @param {number|null} watts null: unknown now (nothing counted until the next reading)
   * @param {number} at time of the reading (ms)
   */
  add(deviceId, watts, at = this.now()) {
    let total = this.totals.get(deviceId) ?? 0;
    const previous = this.last.get(deviceId);
    if (previous && at > previous.at && at - previous.at <= this.maxGap) {
      total += previous.watts * (at - previous.at) * KWH_PER_WATT_MS;
      this.dirty = true;
    }
    if (typeof watts === 'number' && Number.isFinite(watts) && watts >= 0) {
      this.last.set(deviceId, { watts, at });
    } else {
      this.last.delete(deviceId);
    }
    if (!this.totals.has(deviceId)) {
      this.dirty = true;
    }
    this.totals.set(deviceId, total);
    if (this.dirty && at - this.savedAt >= this.saveEvery) {
      this.save();
    }
    return Math.round(total * 1000) / 1000;
  }

  /** Forget the last reading (the link dropped): the next one starts again. */
  pause(deviceId) {
    this.last.delete(deviceId);
  }

  save() {
    if (!this.dirty) {
      return;
    }
    const totals = [...this.totals].map(([id, kwh]) => [id, Math.round(kwh * 1e6) / 1e6]);
    this.store.save('energy', { totals: Object.fromEntries(totals) });
    this.savedAt = this.now();
    this.dirty = false;
  }
}
