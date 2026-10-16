// -----------------------------------------------------------------------------
// A fake Panasonic cloud behind a `fetch`: the Auth0 login of the Panasonic ID
// (authorize, login page and its _csrf cookie, credentials, callback form,
// redirections, PKCE checked at the token exchange, two-factor prompt), the
// client id (`/auth/v2/login`, the signed headers checked), the device list
// and the Aquarea transfer proxy (status live or cached, commands applied to
// the status, consumption). The real client (createHttp) runs on top of it.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import * as fixtures from '../fixtures/cloud.js';
import { apiKey, compareVersions } from '../../src/cloud/session.js';

const AUTH = 'https://authglb.digital.panasonic.com';
const ACC = 'https://accsmart.panasonic.com';
const REDIRECT =
  'panasonic-iot-cfc://authglb.digital.panasonic.com/android/com.panasonic.ACCsmart/callback';

const b64 = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
/** An unsigned JWT with an `exp`, like the access tokens (the client only reads `exp`). */
export const jwt = (expSeconds) => `${b64({ alg: 'none' })}.${b64({ exp: expSeconds })}.sig`;

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const redirect = (location, headers = {}) =>
  new Response('', { status: 302, headers: { location, ...headers } });
const html = (body, headers = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...headers } });

/**
 * @param {object} [options]
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {boolean} [options.mfa] the account asks for a two-factor code
 * @param {string} [options.minVersion] older x-app-version -> 401 4106
 * @param {string} [options.storeVersion] version shown by the Play Store page
 * @param {() => number} [options.now]
 */
export function createFakePanasonic({
  username = 'louis@example.com',
  password = 'secret-password',
  mfa = false,
  minVersion = '4.0.0',
  storeVersion = '4.5.0',
  now = () => Date.now(),
} = {}) {
  const state = {
    challenge: undefined,
    code: undefined,
    accessTokens: new Set(),
    refreshTokens: new Set(),
    logins: 0,
    passwordsSent: 0,
    refreshes: 0,
    clientId: 'client-id-1',
    statuses: new Map([
      [fixtures.GUID, fixtures.statusTwoZones()],
      [fixtures.GUID_2, fixtures.statusHeatOnlyError()],
    ]),
    groups: structuredClone(fixtures.groups),
    offline: new Set(),
    commands: [],
    consumption: fixtures.consumptionOctober,
    consumptionCalls: [],
    statusCalls: [],
    minVersion,
    expiresIn: 86_400,
    agreement: false,
  };
  const calls = [];
  let counter = 0;

  function issueTokens() {
    counter += 1;
    const access = jwt(Math.floor(now() / 1000) + state.expiresIn);
    const refresh = `refresh-${counter}`;
    state.accessTokens.add(access);
    state.refreshTokens.add(refresh);
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: state.expiresIn,
      scope: 'openid offline_access comfortcloud.control a2w.control',
      token_type: 'Bearer',
    };
  }

  /** The signed headers of the Comfort Cloud API: version, key, token, client id. */
  function checkApi(headers, { clientId = true } = {}) {
    const token = (headers.get('x-user-authorization-v2') ?? '').replace(/^Bearer /, '');
    if (!state.accessTokens.has(token)) {
      return json(401, { code: 4100, message: 'Token expires' });
    }
    const version = headers.get('x-app-version') ?? '';
    if (compareVersions(version, state.minVersion) < 0) {
      return json(401, { code: 4106, message: 'New version app has been published' });
    }
    const timestamp = headers.get('x-app-timestamp') ?? '';
    if (headers.get('x-cfc-api-key') !== apiKey(timestamp, token)) {
      return json(401, { code: 4101, message: 'bad api key' });
    }
    if (clientId && headers.get('x-client-id') !== state.clientId) {
      return json(401, { code: 4102, message: 'no client id' });
    }
    return null;
  }

  function transfer(body) {
    const { apiName, requestMethod, bodyParam } = body ?? {};
    const path = String(apiName ?? '');
    if (requestMethod === 'GET' && path.startsWith('/remote/v1/api/devices?')) {
      const params = new URLSearchParams(path.split('?')[1]);
      const guid = params.get('gwid');
      const live = params.get('deviceDirect') === '1';
      state.statusCalls.push({ guid, live });
      if (!state.statuses.has(guid)) {
        return json(200, { message: [{ errorCode: '2011-0001', errorMessage: 'No device.' }] });
      }
      if (live && state.offline.has(guid)) {
        return json(200, fixtures.refusalOffline);
      }
      return json(200, state.statuses.get(guid));
    }
    if (requestMethod === 'POST' && path === '/remote/v1/api/devices') {
      const { gwid, ...change } = bodyParam ?? {};
      state.commands.push({ gwid, change });
      const status = state.statuses.get(gwid)?.status;
      if (!status) {
        return json(200, { message: [{ errorCode: '2011-0001', errorMessage: 'No device.' }] });
      }
      for (const [key, value] of Object.entries(change)) {
        if (key === 'zoneStatus') {
          for (const z of value) {
            Object.assign(status.zoneStatus.find((s) => s.zoneId === z.zoneId) ?? {}, z);
          }
        } else if (key === 'tankStatus') {
          Object.assign(status.tankStatus, value);
        } else if (key === 'operationMode') {
          // The status reads 1 heat, 2 cool, 3 auto heat; commands set 2, 3, 8 (0 off).
          status.operationMode = { 0: 0, 2: 1, 3: 2, 8: 3 }[value];
        } else {
          status[key] = value;
        }
      }
      return json(200, {});
    }
    if (requestMethod === 'POST' && path === '/remote/v1/api/consumption') {
      state.consumptionCalls.push(bodyParam);
      return json(200, state.consumption);
    }
    return json(404, { message: `unknown api ${path}` });
  }

  async function fakeFetch(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers ?? {});
    let body;
    if (typeof init.body === 'string') {
      body = (headers.get('content-type') ?? '').includes('json')
        ? JSON.parse(init.body)
        : Object.fromEntries(new URLSearchParams(init.body));
    }
    calls.push({ method, url: url.toString(), body });
    const route = `${method} ${url.origin}${url.pathname}`;

    switch (route) {
      case `GET ${AUTH}/authorize`: {
        const p = url.searchParams;
        if (
          p.get('client_id') !== 'Xmy6xIYIitMxngjB2rHvlm6HSDNnaMJx' ||
          p.get('code_challenge_method') !== 'S256' ||
          !p.get('scope')?.includes('a2w.control') ||
          p.get('redirect_uri') !== REDIRECT
        ) {
          return json(400, { error: 'invalid_request' });
        }
        state.challenge = p.get('code_challenge');
        state.state = p.get('state');
        return redirect(`/u/login?state=login-state-1`);
      }
      case `GET ${AUTH}/u/login`:
        return html('<html><body>Log in</body></html>', {
          'set-cookie': '_csrf=csrf-token-1; Path=/usernamepassword/login; HttpOnly',
        });
      case `POST ${AUTH}/usernamepassword/login`: {
        state.logins += 1;
        state.passwordsSent += 1;
        if (body._csrf !== 'csrf-token-1' || body.state !== 'login-state-1') {
          return json(403, { code: 'invalid_csrf', description: 'Invalid state' });
        }
        if (body.username !== username || body.password !== password) {
          return json(401, {
            name: 'ValidationError',
            code: 'invalid_user_password',
            description: 'Wrong email or password.',
          });
        }
        if (mfa) {
          return html(
            '<form method="post"><input type="hidden" name="mfa_token" value="mfa-token-1"></form>',
          );
        }
        return html(
          '<form method="post" action="/login/callback">' +
            '<input type="hidden" name="wa" value="wsignin1.0">' +
            '<input type="hidden" name="wresult" value="eyJ&amp;result">' +
            '<input type="hidden" name="wctx" value="{&quot;state&quot;:&quot;x&quot;}">' +
            '</form>',
        );
      }
      case `POST ${AUTH}/login/callback`:
        if (body.wa !== 'wsignin1.0' || body.wresult !== 'eyJ&result') {
          return json(400, { error: 'bad callback' });
        }
        return redirect('/authorize/resume?state=resume-1');
      case `GET ${AUTH}/authorize/resume`:
        state.code = `code-${state.logins}`;
        return redirect(`${REDIRECT}?code=${state.code}&state=${state.state}`);
      case `POST ${AUTH}/mfa/challenge`:
        return json(200, { challenge_type: 'otp' });
      case `POST ${AUTH}/oauth/token`: {
        if (body.grant_type === 'authorization_code') {
          const challenge = createHash('sha256').update(body.code_verifier).digest('base64url');
          if (body.code !== state.code || challenge !== state.challenge) {
            return json(403, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
          }
          state.code = undefined;
          return json(200, issueTokens());
        }
        if (body.grant_type === 'refresh_token') {
          state.refreshes += 1;
          if (!state.refreshTokens.has(body.refresh_token)) {
            return json(403, {
              error: 'invalid_grant',
              error_description: 'Unknown refresh token',
            });
          }
          return json(200, issueTokens());
        }
        if (body.grant_type === 'http://auth0.com/oauth/grant-type/mfa-otp') {
          if (body.mfa_token !== 'mfa-token-1' || body.otp !== '123456') {
            return json(403, { error: 'invalid_grant', error_description: 'Invalid otp_code.' });
          }
          return json(200, issueTokens());
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      case `POST ${ACC}/auth/v2/login`: {
        const refused = checkApi(headers, { clientId: false });
        return refused ?? json(200, { clientId: state.clientId, result: 0 });
      }
      case `GET ${ACC}/device/group`: {
        const refused = checkApi(headers);
        if (refused) {
          return refused;
        }
        if (state.agreement) {
          return json(403, { code: 4103, message: 'Agreement not accepted' });
        }
        return json(200, state.groups);
      }
      case `POST ${ACC}/remote/v1/app/common/transfer`:
        return checkApi(headers) ?? transfer(body);
      case 'GET https://play.google.com/store/apps/details':
        return html(`<script>AF_initDataCallback({data:[[["${storeVersion}"]]]});</script>`);
      case 'GET https://www.appbrain.com/app/panasonic-comfort-cloud/com.panasonic.ACCsmart':
        return html('<html></html>');
      default:
        return json(404, { message: `no route ${route}` });
    }
  }

  return { fetch: fakeFetch, state, calls };
}
