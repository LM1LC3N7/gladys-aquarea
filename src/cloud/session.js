// -----------------------------------------------------------------------------
// The Panasonic ID session: the login (Auth0, PKCE, as the Comfort Cloud
// Android application does it since 2024; Aquarea heat pumps are in that
// application, scope `a2w.control`), the token refresh, the signed headers of
// the API, and one API call at a time.
//
// The login is the one of aioaquarea 1.0.7 (cjaliaga, MIT) and of
// aio-panasonic-comfort-cloud (sockless-coding, MIT), as ported to JavaScript
// by guim31/gladys-panasonic-cc (Apache-2.0, src/panasonic/cloud.js and
// appversion.js), adapted here. When Panasonic changes the login, compare
// with sockless-coding's panasonicauthentication.py first: it is the most
// actively maintained (two-factor variants included).
//
// The session (tokens, client id, application version) is handed to `save`
// after every change, so a restart reuses it instead of logging in again: the
// password is only sent when the refresh token no longer works.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import {
  ACC_BASE,
  API_ERROR,
  API_KEY_SALT,
  API_USER_AGENT,
  APPBRAIN_URL,
  APP_CLIENT_ID,
  APP_NAME,
  APP_VERSION_MAX_AGE_MS,
  AUDIENCE,
  AUTH0_CLIENT,
  AUTH_BASE,
  AUTH_CONNECTION,
  AUTH_TENANT,
  BROWSER_USER_AGENT,
  DEFAULT_APP_VERSION,
  PLAY_STORE_URL,
  REDIRECT_URI,
  SCOPE,
} from './constants.js';
import { guardianConfig, hiddenInputs, unescapeJs } from './html.js';
import { CookieJar, PanasonicError, createHttp, refusalDetails } from './http.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A random string of letters and digits (PKCE verifier, OAuth state). */
export function randomString(length) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/** The S256 PKCE challenge of a verifier (base64url, no padding). */
export function codeChallenge(verifier) {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

const pad = (number) => String(number).padStart(2, '0');

/** "2026-10-15 08:30:00", local time, as the application writes x-app-timestamp. */
export function appTimestamp(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * The x-cfc-api-key of a request: SHA-256 of the application name, a fixed
 * salt, the timestamp read as UTC milliseconds and the bearer token, with
 * "cfc" inserted after the 9th hex digit.
 */
export function apiKey(timestamp, token) {
  const [day, time] = timestamp.split(' ');
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes, seconds] = time.split(':').map(Number);
  const ms = Date.UTC(year, month - 1, date, hours, minutes, seconds);
  const hash = createHash('sha256')
    .update(`${APP_NAME}${API_KEY_SALT}${ms}Bearer ${token}`, 'utf8')
    .digest('hex');
  return `${hash.slice(0, 9)}cfc${hash.slice(9)}`;
}

/** The `exp` of a JWT, in milliseconds, or null. */
export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// --- Application version -------------------------------------------------------

const VERSION = /^\d+(\.\d+){1,3}$/;

export const isVersion = (value) => typeof value === 'string' && VERSION.test(value.trim());

/** Compare two dotted versions: negative, zero or positive. */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** The version in the Google Play page (`["4.3.0"]` in its inline data). */
export function parsePlayStore(html) {
  return /\["(\d+\.\d+\.\d+)"\]/.exec(String(html))?.[1] ?? null;
}

/** The version in the AppBrain page (`<meta itemprop="softwareVersion" content="4.3.0">`). */
export function parseAppBrain(html) {
  for (const [tag] of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    if (/itemprop\s*=\s*["']?softwareVersion["']?/i.test(tag)) {
      const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim();
      if (isVersion(content)) {
        return content;
      }
    }
  }
  return null;
}

/** The current version from the stores, or null when neither answers with one. */
export async function fetchStoreVersion(request) {
  const sources = [
    [PLAY_STORE_URL, parsePlayStore],
    [APPBRAIN_URL, parseAppBrain],
  ];
  for (const [url, parse] of sources) {
    try {
      const answer = await request(url, { headers: { 'user-agent': BROWSER_USER_AGENT } });
      const version = answer.status === 200 ? parse(answer.text) : null;
      if (version) {
        return version;
      }
    } catch {
      // The next source.
    }
  }
  return null;
}

// --- The session -----------------------------------------------------------------

const query = (location, name) => {
  try {
    return new URL(location).searchParams.get(name);
  } catch {
    return null;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A refused step of the login or of an API call, without its body. */
function refused(step, answer, kind = 'http') {
  const { code, message } = refusalDetails(answer.text);
  const detail = [code, message].filter(Boolean).join(': ');
  return new PanasonicError(`${step}: HTTP ${answer.status}${detail ? ` (${detail})` : ''}`, {
    kind,
    status: answer.status,
    code,
  });
}

const expect = (step, answer, statuses) => {
  if (!statuses.includes(answer.status)) {
    throw refused(step, answer);
  }
};

const parseJson = (step, answer) => {
  try {
    return JSON.parse(answer.text);
  } catch {
    throw new PanasonicError(`${step}: the answer is not JSON`, { kind: 'protocol' });
  }
};

export class PanasonicSession {
  /**
   * @param {object} options
   * @param {string} options.username Panasonic ID
   * @param {string} options.password
   * @param {object} [options.session] what `save` received last time
   * @param {(session: object) => unknown} [options.save]
   * @param {string} [options.appVersion] pinned application version ('' = automatic)
   * @param {Function} [options.request] createHttp() request (tests)
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {() => number} [options.now]
   */
  constructor({
    username,
    password,
    session = {},
    save = () => {},
    appVersion = '',
    request,
    sleep: wait = sleep,
    now = () => Date.now(),
  }) {
    this.username = username;
    this.password = password;
    this.saveSession = save;
    this.pinnedVersion = isVersion(appVersion) ? appVersion.trim() : null;
    this.request = request ?? createHttp();
    this.sleep = wait;
    this.now = now;
    this.jar = new CookieJar();
    // A session saved for another Panasonic ID is not reused.
    const same = session?.username === username;
    const pick = (key, check) => (same && check(session[key]) ? session[key] : null);
    const isText = (v) => typeof v === 'string' && v !== '';
    this.session = {
      username,
      accessToken: pick('accessToken', isText),
      refreshToken: pick('refreshToken', isText),
      expiresAt: pick('expiresAt', Number.isFinite),
      scope: pick('scope', isText),
      clientId: pick('clientId', isText),
      appVersion: isVersion(session?.appVersion) ? session.appVersion : null,
      appVersionAt: Number.isFinite(session?.appVersionAt) ? session.appVersionAt : null,
    };
    // One API call at a time, like the application.
    this.queue = Promise.resolve();
  }

  save() {
    return this.saveSession({ ...this.session });
  }

  // --- Application version ---------------------------------------------------

  /** The version to announce: pinned, recent from a store, or read again. */
  async appVersion() {
    if (this.pinnedVersion) {
      return this.pinnedVersion;
    }
    const { appVersion, appVersionAt } = this.session;
    if (appVersionAt && this.now() - appVersionAt < APP_VERSION_MAX_AGE_MS) {
      return appVersion ?? DEFAULT_APP_VERSION;
    }
    await this.refreshAppVersion();
    return this.session.appVersion ?? DEFAULT_APP_VERSION;
  }

  /** Read the version from the stores again; it never goes below the default nor down. */
  async refreshAppVersion() {
    if (this.pinnedVersion) {
      return;
    }
    const found = await fetchStoreVersion(this.request);
    const current = this.session.appVersion ?? DEFAULT_APP_VERSION;
    if (found && compareVersions(found, current) > 0) {
      this.session.appVersion = found;
    }
    // Tried, found or not: not again before two days (or a 4106).
    this.session.appVersionAt = this.now();
    await this.save();
  }

  // --- Login -----------------------------------------------------------------

  /** True while the access token is valid for at least another minute. */
  hasValidToken() {
    const { accessToken, expiresAt } = this.session;
    if (!accessToken) {
      return false;
    }
    const expiry = tokenExpiry(accessToken) ?? expiresAt;
    return expiry !== null && this.now() < expiry - 60_000;
  }

  /** A valid access token: refreshed, or a new login. */
  async ensureSession() {
    if (this.hasValidToken() && this.session.clientId) {
      return;
    }
    if (this.session.refreshToken) {
      try {
        await this.refreshToken();
        if (!this.session.clientId) {
          await this.retrieveClientId();
        }
        return;
      } catch (err) {
        if (err.kind === 'network') {
          throw err;
        }
        // The refresh token expired or was revoked: log in again.
      }
    }
    await this.login();
  }

  /**
   * The whole Panasonic ID login. Throws a PanasonicError of kind
   * `credentials` (refused), `mfa` (a two-factor code is needed: call again
   * with `otp`), `network`, `protocol` or `http`.
   * @param {string} [otp] the current code of the authenticator application
   */
  async login(otp) {
    if (!this.username || !this.password) {
      throw new PanasonicError('No Panasonic ID configured', { kind: 'credentials' });
    }
    this.jar.clear();
    const verifier = randomString(43);
    const state = randomString(20);
    const params = new URLSearchParams({
      scope: SCOPE,
      audience: AUDIENCE,
      protocol: 'oauth2',
      response_type: 'code',
      code_challenge: codeChallenge(verifier),
      code_challenge_method: 'S256',
      auth0Client: AUTH0_CLIENT,
      client_id: APP_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state,
    });
    const authorize = await this.request(`${AUTH_BASE}/authorize?${params}`, {
      headers: { 'user-agent': API_USER_AGENT },
      jar: this.jar,
    });
    expect('authorize', authorize, [302]);
    if (!authorize.location) {
      throw new PanasonicError('authorize: no redirection', { kind: 'protocol' });
    }

    let code;
    if (authorize.location.startsWith(REDIRECT_URI)) {
      // A session the server still knows: straight to the code.
      code = query(authorize.location, 'code');
    } else {
      const challenge = await this.submitCredentials(authorize.location);
      if (challenge) {
        if (!otp) {
          throw new PanasonicError('Panasonic asks for a two-factor code', { kind: 'mfa' });
        }
        await this.verifyMfa(challenge, otp, verifier);
        await this.retrieveClientId();
        return;
      }
      code = this.pendingCode;
    }
    if (!code) {
      throw new PanasonicError('login: no authorization code', { kind: 'protocol' });
    }
    await this.exchangeCode(code, verifier);
    await this.retrieveClientId();
  }

  /**
   * The login page, the credentials, the callback form. Leaves the code in
   * `pendingCode`, or resolves with the two-factor challenge met on the way.
   */
  async submitCredentials(loginLocation) {
    this.pendingCode = null;
    const state = query(loginLocation, 'state');
    const page = await this.request(loginLocation, { jar: this.jar });
    expect('login page', page, [200]);
    const csrf = this.jar.get(loginLocation, '_csrf');
    if (!csrf) {
      throw new PanasonicError('login page: no _csrf cookie', { kind: 'protocol' });
    }

    const login = await this.request(`${AUTH_BASE}/usernamepassword/login`, {
      method: 'POST',
      headers: { 'Auth0-Client': AUTH0_CLIENT, 'user-agent': API_USER_AGENT },
      json: {
        client_id: APP_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        tenant: AUTH_TENANT,
        response_type: 'code',
        scope: SCOPE,
        audience: AUDIENCE,
        _csrf: csrf,
        state,
        _intstate: 'deprecated',
        username: this.username,
        password: this.password,
        lang: 'en',
        connection: AUTH_CONNECTION,
      },
      jar: this.jar,
    });
    if ([400, 401, 403].includes(login.status)) {
      throw refused('login', login, 'credentials');
    }
    expect('login', login, [200]);

    const fields = hiddenInputs(login.text);
    const early = this.mfaChallenge(fields, login.text);
    if (early) {
      return early;
    }

    const callback = await this.request(`${AUTH_BASE}/login/callback`, {
      method: 'POST',
      headers: { 'user-agent': BROWSER_USER_AGENT },
      form: fields,
      jar: this.jar,
    });
    expect('login callback', callback, [302]);
    const resume = await this.request(callback.location, { jar: this.jar });
    expect('login redirect', resume, [302]);
    const code = resume.location ? query(resume.location, 'code') : null;
    if (code) {
      this.pendingCode = code;
      return null;
    }
    if (!resume.location || resume.location.startsWith(REDIRECT_URI)) {
      throw new PanasonicError('login: the redirections ended without a code', {
        kind: 'protocol',
      });
    }
    // A step-up page some accounts get here: a two-factor prompt?
    const step = await this.request(resume.location, { jar: this.jar });
    const late = this.mfaChallenge(hiddenInputs(step.text), step.text);
    if (late) {
      return late;
    }
    throw new PanasonicError('login: no authorization code and no two-factor prompt', {
      kind: 'protocol',
    });
  }

  /** The two-factor challenge of a page: Universal Login (`mfa_token`) or Guardian. */
  mfaChallenge(fields, html) {
    if (fields.mfa_token) {
      return { type: 'otp', mfaToken: fields.mfa_token };
    }
    const guardian = guardianConfig(html);
    if (guardian) {
      return {
        type: 'guardian',
        serviceUrl: unescapeJs(guardian.serviceUrl),
        requestToken: unescapeJs(guardian.requestToken),
        postActionURL: unescapeJs(guardian.postActionURL),
      };
    }
    return null;
  }

  async verifyMfa(challenge, otp, verifier) {
    const code = String(otp).replace(/\s+/g, '');
    if (challenge.type === 'otp') {
      const headers = { 'Auth0-Client': AUTH0_CLIENT, 'user-agent': API_USER_AGENT };
      // Recommended by Auth0 before the code; an authenticator code works without it.
      await this.request(`${AUTH_BASE}/mfa/challenge`, {
        method: 'POST',
        headers,
        json: { mfa_token: challenge.mfaToken, client_id: APP_CLIENT_ID, challenge_type: 'otp' },
      }).catch(() => null);
      const before = this.now();
      const answer = await this.request(`${AUTH_BASE}/oauth/token`, {
        method: 'POST',
        headers,
        json: {
          grant_type: 'http://auth0.com/oauth/grant-type/mfa-otp',
          client_id: APP_CLIENT_ID,
          mfa_token: challenge.mfaToken,
          otp: code,
        },
      });
      if ([400, 401, 403].includes(answer.status)) {
        throw refused('two-factor code', answer, 'mfa');
      }
      expect('two-factor code', answer, [200]);
      await this.setTokens(parseJson('two-factor code', answer), before);
      return;
    }

    // Guardian: Panasonic's own "appliance-mfa" backend, as guardian-js drives it.
    const json = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });
    const start = await this.request(`${challenge.serviceUrl}/api/start-flow`, {
      method: 'POST',
      headers: json(challenge.requestToken),
      json: { state_transport: 'polling' },
    });
    expect('two-factor start', start, [200, 201, 204]);
    const startBody = parseJson('two-factor start', start);
    const transaction = startBody.transactionToken ?? startBody.transaction_token;
    if (!transaction) {
      throw new PanasonicError('two-factor start: no transaction', { kind: 'protocol' });
    }
    const verify = await this.request(`${challenge.serviceUrl}/api/verify-otp`, {
      method: 'POST',
      headers: json(transaction),
      json: { type: 'manual_input', code },
    });
    if (verify.status === 403) {
      throw refused('two-factor code', verify, 'mfa');
    }
    expect('two-factor code', verify, [200, 201, 204]);
    let signature = null;
    for (let attempt = 0; attempt < 10 && !signature; attempt += 1) {
      const answer = await this.request(`${challenge.serviceUrl}/api/transaction-state`, {
        method: 'POST',
        headers: json(transaction),
      });
      expect('two-factor state', answer, [200, 201, 204]);
      const body = parseJson('two-factor state', answer);
      if (body.state === 'accepted') {
        signature = body.token;
      } else if (body.state === 'rejected') {
        throw new PanasonicError('two-factor code rejected', { kind: 'mfa' });
      } else {
        await this.sleep(1000);
      }
    }
    if (!signature) {
      throw new PanasonicError('two-factor: no answer in time', { kind: 'mfa' });
    }
    let answer = await this.request(challenge.postActionURL, {
      method: 'POST',
      headers: { 'user-agent': BROWSER_USER_AGENT },
      form: { accepted: 'true', signature },
      jar: this.jar,
    });
    expect('two-factor callback', answer, [302]);
    for (let hop = 0; hop < 5; hop += 1) {
      const found = answer.location ? query(answer.location, 'code') : null;
      if (found) {
        await this.exchangeCode(found, verifier);
        return;
      }
      if (!answer.location || answer.location.startsWith(REDIRECT_URI)) {
        break;
      }
      answer = await this.request(answer.location, { jar: this.jar });
      expect('two-factor redirect', answer, [302]);
    }
    throw new PanasonicError('two-factor: the redirections ended without a code', {
      kind: 'protocol',
    });
  }

  async exchangeCode(code, verifier) {
    const before = this.now();
    const answer = await this.request(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Auth0-Client': AUTH0_CLIENT, 'user-agent': API_USER_AGENT },
      json: {
        scope: 'openid',
        client_id: APP_CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
    });
    expect('token', answer, [200]);
    await this.setTokens(parseJson('token', answer), before);
  }

  async refreshToken() {
    const before = this.now();
    // aioaquarea 1.0.7 leaves the refresh token out of this request; the
    // reference login (aio-panasonic-comfort-cloud) sends it, as OAuth wants.
    const answer = await this.request(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Auth0-Client': AUTH0_CLIENT, 'user-agent': API_USER_AGENT },
      json: {
        scope: this.session.scope ?? SCOPE,
        client_id: APP_CLIENT_ID,
        refresh_token: this.session.refreshToken,
        grant_type: 'refresh_token',
      },
    });
    expect('token refresh', answer, [200]);
    await this.setTokens(parseJson('token refresh', answer), before);
  }

  async setTokens(body, receivedAt) {
    if (typeof body.access_token !== 'string') {
      throw new PanasonicError('token: no access token', { kind: 'protocol' });
    }
    this.session.accessToken = body.access_token;
    if (typeof body.refresh_token === 'string') {
      this.session.refreshToken = body.refresh_token;
    }
    if (Number.isFinite(body.expires_in)) {
      this.session.expiresAt = receivedAt + body.expires_in * 1000;
    }
    if (typeof body.scope === 'string') {
      this.session.scope = body.scope;
    }
    await this.save();
  }

  /** The client id of this login (x-client-id). */
  async retrieveClientId() {
    const body = await this.send('POST', '/auth/v2/login', { language: 0 }, 'client id', {
      clientId: false,
    });
    if (typeof body.clientId !== 'string') {
      throw new PanasonicError('client id: none in the answer', { kind: 'protocol' });
    }
    this.session.clientId = body.clientId;
    await this.save();
  }

  // --- API -------------------------------------------------------------------

  async headers({ clientId = true } = {}) {
    const timestamp = appTimestamp(new Date(this.now()));
    const token = this.session.accessToken ?? '';
    const headers = {
      accept: 'application/json; charset=utf-8',
      'content-type': 'application/json',
      'user-agent': 'G-RAC',
      'x-app-name': APP_NAME,
      'x-app-timestamp': timestamp,
      'x-app-type': '1',
      'x-app-version': await this.appVersion(),
      'x-cfc-api-key': apiKey(timestamp, token),
      'x-user-authorization-v2': `Bearer ${token}`,
    };
    if (clientId && this.session.clientId) {
      headers['x-client-id'] = this.session.clientId;
    }
    return headers;
  }

  /**
   * One API call, without the session check (see `call`): a 4106 reads the
   * application version again and retries once.
   */
  async send(method, path, body, step, { clientId = true } = {}) {
    const go = async () =>
      this.request(`${ACC_BASE}${path}`, {
        method,
        headers: await this.headers({ clientId }),
        json: body,
      });
    let answer = await go();
    if (answer.status === 401 && answer.text.includes(API_ERROR.NEW_VERSION)) {
      await this.refreshAppVersion();
      answer = await go();
      if (answer.status === 401 && answer.text.includes(API_ERROR.NEW_VERSION)) {
        throw refused(step, answer, 'version');
      }
    }
    if (answer.status !== 200) {
      const error = refused(step, answer);
      if (error.code === API_ERROR.AGREEMENT || answer.text.includes(API_ERROR.AGREEMENT)) {
        error.kind = 'agreement';
      }
      throw error;
    }
    return parseJson(step, answer);
  }

  /** An API call with a valid session; a refused token is renewed once. */
  call(method, path, body, step) {
    const run = async () => {
      await this.ensureSession();
      try {
        return await this.send(method, path, body, step);
      } catch (err) {
        if (err.status !== 401 || err.kind === 'version') {
          throw err;
        }
        // The token was refused before its expiry (revoked): a new one, once.
        this.session.accessToken = null;
        await this.ensureSession();
        return this.send(method, path, body, step);
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}
