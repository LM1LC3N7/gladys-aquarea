// -----------------------------------------------------------------------------
// Test helpers: timers running faster than the clock, a wait-until, and an
// in-memory MQTT broker speaking the surface of an mqtt.js client (connect,
// subscribe with + and #, retained messages, publish, end).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

/** Timers `factor` times faster: the app's seconds become milliseconds. */
export function fastTimers(factor = 100) {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, Math.max(1, Math.round(ms / factor))),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (fn, ms) => setInterval(fn, Math.max(1, Math.round(ms / factor))),
    clearInterval: (t) => clearInterval(t),
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check()` is truthy (polled every 10 ms), or fails after `ms`. */
export async function waitFor(check, ms = 3000, label = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) {
      return value;
    }
    if (Date.now() > end) {
      throw new Error(`timeout waiting for ${label}`);
    }
    await sleep(10);
  }
}

/** Does an MQTT topic match a subscription filter? */
export function matches(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] === '#') {
      return true;
    }
    if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) {
      return false;
    }
  }
  return f.length === t.length;
}

/**
 * An in-memory broker. `broker.connect` is the mqtt.connect of the app;
 * `broker.publish` is a device (HeishaMon) publishing; `broker.published`
 * records what the clients published.
 */
export function fakeBroker({ refuse } = {}) {
  const retained = new Map();
  const clients = new Set();
  const published = [];

  function deliver(topic, payload) {
    for (const client of clients) {
      if (client.filters.some((f) => matches(f, topic))) {
        client.emit('message', topic, Buffer.from(payload));
      }
    }
  }

  const broker = {
    clients,
    published,
    retained,
    connections: [],
    publish(topic, payload, { retain = true } = {}) {
      if (retain) {
        retained.set(topic, String(payload));
      }
      deliver(topic, String(payload));
    },
    /** Every topic of `values` (`main/Name` -> text) under `base`, retained. */
    publishAll(base, values) {
      for (const [sub, payload] of Object.entries(values)) {
        broker.publish(`${base}/${sub}`, payload);
      }
    },
    connect(url, options) {
      broker.connections.push({ url, options });
      const client = new EventEmitter();
      client.filters = [];
      client.subscribe = (filters, opts, cb) => {
        const list = Array.isArray(filters) ? filters : [filters];
        client.filters.push(...list);
        const done = typeof opts === 'function' ? opts : cb;
        setImmediate(() => {
          done?.(
            null,
            list.map((topic) => ({ topic, qos: 0 })),
          );
          for (const [topic, payload] of retained) {
            if (list.some((f) => matches(f, topic))) {
              client.emit('message', topic, Buffer.from(payload));
            }
          }
        });
      };
      client.publish = (topic, payload, opts, cb) => {
        published.push({ topic, payload: String(payload) });
        const done = typeof opts === 'function' ? opts : cb;
        setImmediate(() => done?.(null));
      };
      client.end = () => {
        clients.delete(client);
        client.ended = true;
      };
      setImmediate(() => {
        if (refuse) {
          client.emit('error', Object.assign(new Error('Connection refused'), { code: refuse }));
          return;
        }
        clients.add(client);
        client.emit('connect');
      });
      return client;
    },
    /** The broker drops every client. */
    drop() {
      for (const client of clients) {
        clients.delete(client);
        client.emit('close');
      }
    },
  };
  return broker;
}
