
const oidc = require('openid-client');
const crypto = require('node:crypto');

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
  const config = await getGoogleConfig();

  const state = oidc.randomState();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const nonce = crypto.randomBytes(16).toString('hex');

  session.googleOAuth = {
    state,
    codeVerifier,
    nonce
  };

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    scope: 'openid email profile',
    response_type: 'code',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return url.toString();
}

async function verifyGoogleCallback(currentUrl, session) {
  const config = await getGoogleConfig();

  const oauth = session.googleOAuth;

  if (!oauth) {
    throw new Error('OAuth session không tồn tại');
  }

  // Không cho phép sử dụng lại state và PKCE verifier.
  delete session.googleOAuth;

  const tokens = await oidc.authorizationCodeGrant(
    config,
    currentUrl,
    {
      pkceCodeVerifier: oauth.codeVerifier,
      expectedState: oauth.state,
      expectedNonce: oauth.nonce,
      idTokenExpected: true
    }
  );

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

module.exports = {
  getGoogleAuthUrl,
  verifyGoogleCallback
};
