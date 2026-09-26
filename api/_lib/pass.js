// The hourly pass, and encryption for the per-subscriber OpenRouter key.
//
// A pass is `<base64url JSON claims>.<base64url HMAC-SHA256>`. Claims:
//   sub  Stripe subscription id      dev  Mac fingerprint
//   plan "pro" | "pro_max"           orh  OpenRouter key hash
//   ork  OpenRouter key, encrypted   exp  expiry (unix seconds)
// The claims are readable but can't be changed without the signature
// breaking, and `ork` is encrypted so only this server can use it.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PASS_TTL_SECONDS = 60 * 60;

function derivedKeys(secret) {
  return {
    sign:    createHmac('sha256', secret).update('thecloser/pass-signing').digest(),
    encrypt: createHmac('sha256', secret).update('thecloser/key-encryption').digest(),
  };
}

export function encryptSecret(plaintext, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKeys(secret).encrypt, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decryptSecret(blob, secret) {
  const raw = Buffer.from(blob, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', derivedKeys(secret).encrypt, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

function sign(payload, secret) {
  return createHmac('sha256', derivedKeys(secret).sign).update(payload).digest();
}

export function issuePass(claims, secret, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + PASS_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: expiresAt })).toString('base64url');
  return { pass: `${payload}.${sign(payload, secret).toString('base64url')}`, expiresAt };
}

/**
 * Returns the claims when the signature is valid, otherwise null.
 * `allowExpired` is for renewal only: /api/pass re-checks Stripe before
 * issuing a new pass, so an expired one is fine as a hint there.
 */
export function readPass(pass, secret, { allowExpired = false, now = Date.now() } = {}) {
  if (typeof pass !== 'string') return null;
  const [payload, signature] = pass.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!allowExpired && !(claims.exp > Math.floor(now / 1000))) return null;
  return claims;
}
