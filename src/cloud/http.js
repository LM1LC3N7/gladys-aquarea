// -----------------------------------------------------------------------------
// HTTP for the Panasonic cloud: `fetch` with a timeout, redirects left to the
// caller (the Auth0 login reads every Location), and a small cookie jar (the
// login pages keep their state in cookies).
//
// An error never carries a request body nor a whole answer: the login answers
// can hold tokens. Only the error code and message of a refusal are kept.
//
// Adapted from src/panasonic/http.js of guim31/gladys-panasonic-cc
// (Apache-2.0, see THIRD_PARTY_NOTICES.md): same jar and refusal handling.
// -----------------------------------------------------------------------------

export class PanasonicError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {'network'|'credentials'|'mfa'|'agreement'|'version'|'http'|'protocol'|'device'} [details.kind]
   * @param {number} [details.status]
   * @param {string} [details.code] API error code (4106...)
   */
  constructor(message, { kind = 'http', status, code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PanasonicError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const MAX_DETAIL = 160;

/**
 * The code and message of a refusal, from a JSON answer. Nothing else: the
 * rest of an answer may hold a token.
 * @param {string} text
 * @returns {{ code?: string, message?: string }}
 */
export function refusalDetails(text) {
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: an HTML page says nothing useful.
  }
  if (!body || typeof body !== 'object') {
    return {};
  }
  const pick = (...keys) => {
    for (const key of keys) {
      const value = body[key];
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value).slice(0, MAX_DETAIL);
      }
    }
    return undefined;
  };
  return {
    code: pick('code', 'error', 'name'),
    message: pick('message', 'description', 'error_description'),
  };
}

/** A cookie jar per host: enough for the Auth0 pages, which all live on one host. */
export class CookieJar {
  constructor() {
    /** @type {Map<string, Map<string, string>>} host -> name -> value */
    this.hosts = new Map();
  }

  clear() {
    this.hosts.clear();
  }

  /** Keep the cookies an answer sets. */
  store(url, headers) {
    const host = new URL(url).host;
    const list =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter(Boolean);
    for (const line of list) {
      const [pair, ...attributes] = line.split(';');
      const at = pair.indexOf('=');
      if (at <= 0) {
        continue;
      }
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const expired = attributes.some((attribute) => {
        const [key, ...rest] = attribute.split('=');
        const lower = key.trim().toLowerCase();
        if (lower === 'max-age') {
          return Number(rest.join('=')) <= 0;
        }
        if (lower === 'expires') {
          return Date.parse(rest.join('=')) < Date.now();
        }
        return false;
      });
      const cookies = this.hosts.get(host) ?? new Map();
      if (expired) {
        cookies.delete(name);
      } else {
        cookies.set(name, value);
      }
      this.hosts.set(host, cookies);
    }
  }

  get(url, name) {
    return this.hosts.get(new URL(url).host)?.get(name);
  }

  header(url) {
    const cookies = this.hosts.get(new URL(url).host);
    if (!cookies || cookies.size === 0) {
      return undefined;
    }
    return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 */
export function createHttp({ fetch: fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  /**
   * One request. Never follows a redirect, never throws on a status.
   * @param {string} url
   * @param {object} [options]
   * @param {string} [options.method]
   * @param {Record<string, string>} [options.headers]
   * @param {object} [options.json] JSON body
   * @param {Record<string, string>} [options.form] urlencoded body
   * @param {CookieJar} [options.jar] sends and keeps the cookies
   * @returns {Promise<{ status: number, headers: Headers, text: string, location: string|null, url: string }>}
   */
  return async function request(url, { method = 'GET', headers = {}, json, form, jar } = {}) {
    const finalHeaders = { ...headers };
    let body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      finalHeaders['content-type'] ??= 'application/json';
    } else if (form !== undefined) {
      body = new URLSearchParams(form).toString();
      finalHeaders['content-type'] = 'application/x-www-form-urlencoded';
    }
    const cookie = jar?.header(url);
    if (cookie) {
      finalHeaders.cookie = cookie;
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: finalHeaders,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.cause?.code ?? err?.name ?? 'error';
      throw new PanasonicError(`${new URL(url).host} unreachable (${reason})`, {
        kind: 'network',
        cause: err,
      });
    }
    jar?.store(url, response.headers);
    const text = await response.text().catch(() => '');
    const location = response.headers.get('location');
    let absolute = null;
    if (location) {
      try {
        absolute = new URL(location, url).toString();
      } catch {
        // A custom scheme the URL parser refuses: keep it as sent.
        absolute = location;
      }
    }
    return { status: response.status, headers: response.headers, text, location: absolute, url };
  };
}
