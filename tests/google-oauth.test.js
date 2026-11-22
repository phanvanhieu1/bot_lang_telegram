const assert = require('node:assert/strict');
const test = require('node:test');
const oidc = require('openid-client');
const {
  getGoogleRedirectUri,
  createGoogleOAuth
} = require('../modules/auth/google.oauth');

const local = 'http://localhost:3000/auth/google/callback';
const production = 'https://translator.example.test/auth/google/callback';

test('OAuth validates the callback by environment', () => {
  assert.equal(getGoogleRedirectUri({ GOOGLE_REDIRECT_URI: local }), local);
  const env = { NODE_ENV: 'production' };
  for (const uri of [
    undefined,
    local,
    'https://localhost./auth/google/callback',
    'https://127.0.0.2/auth/google/callback',
    'https://[::1]/auth/google/callback',
    production.replace('https:', 'http:'),
    production + '?unexpected=1'
  ]) {
    assert.throws(
      () => getGoogleRedirectUri({ ...env, GOOGLE_REDIRECT_URI: uri }),
      /INVALID_GOOGLE_REDIRECT_URI/
    );
  }
  assert.equal(
    getGoogleRedirectUri({ ...env, GOOGLE_REDIRECT_URI: production }),
    production
  );
});

test('OAuth starts again after logout or expiry and binds the callback to its state', async (t) => {
  const previous = { ...process.env };
  t.after(() => {
    for (const key of ['NODE_ENV', 'GOOGLE_REDIRECT_URI']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  const client = { ...oidc };
  const { getGoogleAuthUrl, verifyGoogleCallback } = createGoogleOAuth(client);
  process.env.NODE_ENV = 'production';
  process.env.GOOGLE_REDIRECT_URI = local;
  await assert.rejects(getGoogleAuthUrl({}), /INVALID_GOOGLE_REDIRECT_URI/);
  process.env.GOOGLE_REDIRECT_URI = production;

  t.mock.method(client, 'discovery', async () => ({}));
  t.mock.method(client, 'buildAuthorizationUrl', (_, params) => {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams(params);
    return url;
  });
  const grant = t.mock.method(client, 'authorizationCodeGrant', async (
    _,
    url,
    checks
  ) => {
    assert.equal(url.origin + url.pathname, production);
    assert.equal(url.searchParams.get('state'), checks.expectedState);
    assert.ok(checks.expectedNonce);
    assert.ok(checks.pkceCodeVerifier);
    return {
      claims: () => ({ sub: 'test-user', email: 'test@example.test', email_verified: true })
    };
  });

  const start = async (session) => {
    const url = new URL(await getGoogleAuthUrl(session));
    assert.equal(url.searchParams.get('redirect_uri'), production);
    return url.searchParams.get('state');
  };
  const firstSession = {};
  const firstState = await start(firstSession);
  const callback = (state) => '/auth/google/callback?code=test&state=' + state;
  await verifyGoogleCallback(
    'https://untrusted.example.test' + callback(firstState),
    firstSession
  );

  for (const reason of ['logout', 'expiry']) {
    const freshSession = {};
    await assert.rejects(
      verifyGoogleCallback(callback(firstState), freshSession),
      /GOOGLE_OAUTH_SESSION_MISSING/,
      reason
    );
    const freshState = await start(freshSession);
    assert.notEqual(freshState, firstState);
    await verifyGoogleCallback(callback(freshState), freshSession);
    assert.equal(freshSession.googleOAuth, undefined);
  }
  assert.equal(grant.mock.callCount(), 3);

  const tamperedSession = {};
  await start(tamperedSession);
  await assert.rejects(verifyGoogleCallback(callback('wrong'), tamperedSession));
  await assert.rejects(
    verifyGoogleCallback(callback('wrong'), tamperedSession),
    /GOOGLE_OAUTH_SESSION_MISSING/
  );
});
