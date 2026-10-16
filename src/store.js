// -----------------------------------------------------------------------------
// Small JSON documents in the integration volume (/data, the only writable
// place of the container): the Panasonic session (tokens, not the password)
// and the energy index. A write goes to a temporary file renamed over the old
// one, so a crash never leaves half a document.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^[a-z0-9-]+$/;

/**
 * @param {{ dir?: string, logger?: object }} [options]
 * @returns {{ load: (name: string) => object|undefined, save: (name: string, data: object) => void }}
 */
export function createStore({ dir = process.env.DATA_DIR || '/data', logger } = {}) {
  const pathOf = (name) => {
    if (!NAME.test(name)) {
      throw new Error(`bad document name ${name}`);
    }
    return join(dir, `${name}.json`);
  };
  return {
    load(name) {
      const path = pathOf(name);
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger?.warn(`Reading ${name}.json failed: ${err.message}`);
        }
        return undefined;
      }
    },
    save(name, data) {
      const path = pathOf(name);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 });
        renameSync(`${path}.tmp`, path);
      } catch (err) {
        logger?.warn(`Writing ${name}.json failed: ${err.message}`);
      }
    },
  };
}

/** A store in memory (tests, and the connection test). */
export function memoryStore(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  return {
    docs,
    load: (name) => (docs.has(name) ? structuredClone(docs.get(name)) : undefined),
    save: (name, data) => docs.set(name, structuredClone(data)),
  };
}
