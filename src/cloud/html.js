// -----------------------------------------------------------------------------
// The two things the login reads in the Auth0 pages, without an HTML parser
// dependency: the hidden fields of a form, and the configuration of the
// Guardian two-factor page.
//
// Adapted from src/panasonic/html.js of guim31/gladys-panasonic-cc
// (Apache-2.0, see THIRD_PARTY_NOTICES.md).
// -----------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode the HTML character references of an attribute value. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** The attributes of one tag (`<input a="1" b='2' c=3 d>`), names in lower case. */
function attributes(tag) {
  const found = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  // Skip the tag name itself.
  const body = tag.replace(/^<\s*[a-z0-9]+/i, '').replace(/\/?>$/, '');
  for (const match of body.matchAll(pattern)) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    found[match[1].toLowerCase()] = decodeEntities(value);
  }
  return found;
}

/**
 * The hidden fields of the page, by name (`wa`, `wresult`, `wctx` of the
 * login callback form, or the `mfa_token` of a two-factor prompt).
 * @param {string} html
 * @returns {Record<string, string>}
 */
export function hiddenInputs(html) {
  const fields = {};
  for (const [tag] of String(html).matchAll(/<input\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    if ((attrs.type ?? '').toLowerCase() === 'hidden' && attrs.name !== undefined) {
      fields[attrs.name] = attrs.value ?? '';
    }
  }
  return fields;
}

const GUARDIAN_KEYS = ['postActionURL', 'serviceUrl', 'requestToken', 'stateCheckingMechanism'];

/**
 * The `window.__g_config` object of the Auth0 Guardian two-factor page, or
 * null. It is JavaScript, not JSON: its string fields are read one by one.
 * @param {string} html
 */
export function guardianConfig(html) {
  const text = String(html);
  if (!text.includes('__g_config')) {
    return null;
  }
  const config = {};
  for (const key of GUARDIAN_KEYS) {
    const match = new RegExp(`${key}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    if (match) {
      config[key] = match[1];
    }
  }
  if (!config.requestToken || !config.serviceUrl || !config.postActionURL) {
    return null;
  }
  config.stateCheckingMechanism ??= 'polling';
  return config;
}

/** The JavaScript escapes of a string read by guardianConfig (`&` -> `&`). */
export function unescapeJs(text) {
  return text.replace(/\\u([0-9a-f]{4})|\\(.)/gi, (_, hex, char) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : char,
  );
}
