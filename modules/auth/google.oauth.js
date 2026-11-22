const openidClient = require('openid-client');
const crypto = require('node:crypto');

function getGoogleRedirectUri(env = process.env) {
  const configured = env.GOOGLE_REDIRECT_URI;
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('INVALID_GOOGLE_REDIRECT_URI');
  }

  const host = url.hostname.replace(/\.$/, '');
  const loopback =
    host === 'localhost' || host.endsWith('.localhost') ||
    host.startsWith('127.') || host === '[::1]' || host === '0.0.0.0';
  const production = env.NODE_ENV === 'production';
  if (
    url.pathname !== '/auth/google/callback' ||
    url.username || url.password || url.search || url.hash ||
    (url.protocol !== 'https:' &&
      (production || url.protocol !== 'http:' || !loopback)) ||
    (production && loopback)
  ) {
    throw new Error('INVALID_GOOGLE_REDIRECT_URI');
  }
  // Google requires the exact registered string, including any explicit port.
  return configured;
}

function createGoogleOAuth(oidc = openidClient) {
  let googleConfig;

  async function getGoogleConfig() {
    if (!googleConfig) {
      googleConfig = await oidc.discovery(
        new URL('https://accounts.google.com'),
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
    }

    return googleConfig;
  }

  async function getGoogleAuthUrl(session) {
    const redirectUri = getGoogleRedirectUri();
    const config = await getGoogleConfig();

    const state = oidc.randomState();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const nonce = crypto.randomBytes(16).toString('hex');

    session.googleOAuth = {
      state,
      codeVerifier,
      nonce,
      redirectUri
    };

    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      response_type: 'code',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return url.toString();
  }

  async function verifyGoogleCallback(requestPath, session) {
    const oauth = session?.googleOAuth;

    if (!oauth) {
      throw new Error('GOOGLE_OAUTH_SESSION_MISSING');
    }

    // Không cho phép sử dụng lại state và PKCE verifier.
    delete session.googleOAuth;
    const redirectUri = getGoogleRedirectUri();
    if (oauth.redirectUri && oauth.redirectUri !== redirectUri) {
      throw new Error('GOOGLE_REDIRECT_URI_CHANGED');
    }
    const currentUrl = new URL(redirectUri);
    currentUrl.search = new URL(requestPath, currentUrl).search;
    const config = await getGoogleConfig();

    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: oauth.codeVerifier,
      expectedState: oauth.state,
      expectedNonce: oauth.nonce,
      idTokenExpected: true
    });

    const claims = tokens.claims();

    if (!claims?.sub) {
      throw new Error('Google không trả về user ID');
    }

    if (!claims.email || claims.email_verified !== true) {
      throw new Error('Email Google chưa được xác minh');
    }

    return {
      provider: 'google',
      providerId: claims.sub,
      email: claims.email,
      name: claims.name || '',
      avatar: claims.picture || ''
    };
  }

  return { getGoogleAuthUrl, verifyGoogleCallback };
}

module.exports = {
  getGoogleRedirectUri,
  createGoogleOAuth,
  ...createGoogleOAuth()
};
