// -----------------------------------------------------------------------------
// The Panasonic ID session against the fake Panasonic cloud: the login, the
// saved session reused without the password, the refresh, the refusals.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp } from '../src/cloud/http.js';
import { hiddenInputs, guardianConfig, unescapeJs } from '../src/cloud/html.js';
import {
  PanasonicSession,
  apiKey,
  codeChallenge,
  compareVersions,
  parseAppBrain,
  parsePlayStore,
  tokenExpiry,
} from '../src/cloud/session.js';
import { createFakePanasonic, jwt } from './helpers/fakePanasonic.js';

const NOW = Date.parse('2026-10-15T08:00:00Z');

function setup(options = {}, sessionOptions = {}) {
  const fake = createFakePanasonic({ now: () => NOW, ...options });
  let saved = sessionOptions.session ?? {};
  const session = new PanasonicSession({
    username: 'louis@example.com',
    password: 'secret-password',
    session: saved,
    save: (s) => {
      saved = s;
    },
    request: createHttp({ fetch: fake.fetch }),
    now: () => NOW,
    sleep: async () => {},
    ...sessionOptions,
  });
  return { fake, session, saved: () => saved };
}

test('the API key and the PKCE challenge match the Python reference', () => {
  // Computed with the code of aio-panasonic-comfort-cloud (panasonicrequestheader.py).
  assert.equal(
    apiKey('2026-10-15 08:30:00', 'header.payload.signature'),
    'aeabccb50cfc6e110b8d72a4c1cf068122015fd7d8f14d24c84c1471b8b5352055c',
  );
  assert.equal(
    codeChallenge('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg'),
    'mTuinsmbs-W2SCEfW7BaGNdW1iifiasHtAO2ktyDbaM',
  );
});

test('the version helpers', () => {
  assert.ok(compareVersions('4.10.0', '4.3.0') > 0);
  assert.equal(compareVersions('4.3', '4.3.0'), 0);
  assert.equal(parsePlayStore('x [["4.5.1"]] y'), '4.5.1');
  assert.equal(parseAppBrain('<meta itemprop="softwareVersion" content="4.2.0">'), '4.2.0');
  assert.equal(parseAppBrain('<meta itemprop="name" content="x">'), null);
  assert.equal(tokenExpiry(jwt(1_800_000_000)), 1_800_000_000_000);
  assert.equal(tokenExpiry('not a token'), null);
});

test('the HTML helpers read the hidden fields and the Guardian configuration', () => {
  assert.deepEqual(
    hiddenInputs(
      `<input type="hidden" name="wa" value="wsignin1.0"><input type='hidden' name=wctx value='{&quot;a&quot;:1}'><input type="text" name="x" value="y">`,
    ),
    { wa: 'wsignin1.0', wctx: '{"a":1}' },
  );
  const page =
    '<script>window.__g_config = { requestToken: "r1", serviceUrl: "https:\\/\\/mfa.example", postActionURL: "https://a/b?x=1\\u0026y=2" };</script>';
  const config = guardianConfig(page);
  assert.equal(config.requestToken, 'r1');
  assert.equal(unescapeJs(config.serviceUrl), 'https://mfa.example');
  assert.equal(unescapeJs(config.postActionURL), 'https://a/b?x=1&y=2');
  assert.equal(guardianConfig('<html></html>'), null);
});

test('a first call logs in (PKCE, callback form, client id) and saves the session', async () => {
  const { fake, session, saved } = setup();
  const groups = await session.call('GET', '/device/group', undefined, 'device list');
  assert.equal(groups.groupList.length, 1);
  assert.equal(fake.state.passwordsSent, 1);
  const s = saved();
  assert.equal(s.username, 'louis@example.com');
  assert.ok(s.accessToken && s.refreshToken);
  assert.equal(s.clientId, 'client-id-1');
  assert.equal(s.password, undefined, 'the password is never saved');
  // The store was read at the first call (the default version is old enough here).
  assert.equal(s.appVersion, '4.5.0');
});

test('a saved session is reused: no password sent again', async () => {
  const first = setup();
  await first.session.call('GET', '/device/group', undefined, 'device list');
  const fake = first.fake;
  let saved = first.saved();
  const session = new PanasonicSession({
    username: 'louis@example.com',
    password: 'secret-password',
    session: saved,
    save: (s) => {
      saved = s;
    },
    request: createHttp({ fetch: fake.fetch }),
    now: () => NOW + 3600_000,
  });
  await session.call('GET', '/device/group', undefined, 'device list');
  assert.equal(fake.state.passwordsSent, 1);
});

test('a saved session of another Panasonic ID is not reused', () => {
  const session = new PanasonicSession({
    username: 'someone@example.com',
    password: 'x',
    session: { username: 'louis@example.com', accessToken: 'a', refreshToken: 'r', clientId: 'c' },
  });
  assert.equal(session.session.accessToken, null);
  assert.equal(session.session.refreshToken, null);
});

test('an expired token is refreshed with the refresh token, not the password', async () => {
  const { fake, session } = setup();
  await session.call('GET', '/device/group', undefined, 'device list');
  session.now = () => NOW + 2 * 86_400_000;
  await session.call('GET', '/device/group', undefined, 'device list');
  assert.equal(fake.state.refreshes, 1);
  assert.equal(fake.state.passwordsSent, 1);
  const refresh = fake.calls.find((c) => c.body?.grant_type === 'refresh_token');
  assert.match(refresh.body.refresh_token, /^refresh-/, 'the refresh token is sent');
});

test('a refused refresh token falls back to a login', async () => {
  const { fake, session } = setup();
  await session.call('GET', '/device/group', undefined, 'device list');
  fake.state.refreshTokens.clear();
  session.now = () => NOW + 2 * 86_400_000;
  await session.call('GET', '/device/group', undefined, 'device list');
  assert.equal(fake.state.passwordsSent, 2);
});

test('a revoked token is renewed once', async () => {
  const { fake, session } = setup();
  await session.call('GET', '/device/group', undefined, 'device list');
  fake.state.accessTokens.clear();
  const groups = await session.call('GET', '/device/group', undefined, 'device list');
  assert.equal(groups.groupList.length, 1);
});

test('a wrong password is a credentials error', async () => {
  const { session } = setup({}, { password: 'wrong' });
  await assert.rejects(session.call('GET', '/device/group', undefined, 'device list'), (err) => {
    assert.equal(err.kind, 'credentials');
    assert.doesNotMatch(err.message, /wrong-password|secret/);
    return true;
  });
});

test('a two-factor account asks for a code, then logs in with it', async () => {
  const { session, saved } = setup({ mfa: true });
  await assert.rejects(session.call('GET', '/device/group', undefined, 'device list'), {
    kind: 'mfa',
  });
  await assert.rejects(session.login('000000'), { kind: 'mfa' });
  await session.login('123 456');
  assert.equal(saved().clientId, 'client-id-1');
  const groups = await session.call('GET', '/device/group', undefined, 'device list');
  assert.equal(groups.groupList.length, 1);
});

test('an outdated application version is read again from the store (4106)', async () => {
  const { session, saved } = setup({ minVersion: '4.5.0', storeVersion: '4.5.0' });
  // Read two days ago: the version is not read again until Panasonic refuses it.
  session.session.appVersion = '4.3.0';
  session.session.appVersionAt = NOW - 1000;
  await session.call('GET', '/device/group', undefined, 'device list');
  assert.equal(saved().appVersion, '4.5.0');
});

test('a pinned version is announced as is; refused, it is a version error', async () => {
  const { session } = setup({ minVersion: '4.5.0' }, { appVersion: '4.1.0' });
  await assert.rejects(session.call('GET', '/device/group', undefined, 'device list'), {
    kind: 'version',
  });
});

test('new terms to accept are an agreement error', async () => {
  const { fake, session } = setup();
  fake.state.agreement = true;
  await assert.rejects(session.call('GET', '/device/group', undefined, 'device list'), {
    kind: 'agreement',
  });
});

test('an unreachable cloud is a network error', async () => {
  const session = new PanasonicSession({
    username: 'a@b.c',
    password: 'p',
    request: createHttp({
      fetch: async () => {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      },
    }),
  });
  await assert.rejects(session.call('GET', '/device/group', undefined, 'x'), (err) => {
    assert.equal(err.kind, 'network');
    assert.match(err.message, /ENOTFOUND/);
    return true;
  });
});
