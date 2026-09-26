import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PASS_TTL_SECONDS, decryptSecret, encryptSecret, issuePass, readPass } from '../api/_lib/pass.js';

const SECRET = 'test-secret-that-is-long-enough-0123456789abcdef';
const claims = { sub: 'sub_123', dev: 'a'.repeat(64), plan: 'pro', orh: 'hash', ork: 'blob' };

test('a fresh pass reads back its claims', () => {
  const now = Date.UTC(2026, 8, 26);
  const { pass, expiresAt } = issuePass(claims, SECRET, now);
  assert.equal(expiresAt, now / 1000 + PASS_TTL_SECONDS);
  const read = readPass(pass, SECRET, { now });
  assert.equal(read.sub, 'sub_123');
  assert.equal(read.plan, 'pro');
});

test('an edited pass is rejected', () => {
  const { pass } = issuePass(claims, SECRET);
  const [payload, signature] = pass.split('.');
  const tampered = JSON.parse(Buffer.from(payload, 'base64url').toString());
  tampered.plan = 'pro_max';
  const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`;
  assert.equal(readPass(forged, SECRET), null);
});

test('a pass signed with another secret is rejected', () => {
  const { pass } = issuePass(claims, 'some-other-secret-0123456789abcdef');
  assert.equal(readPass(pass, SECRET), null);
});

test('an expired pass is rejected, except for renewal', () => {
  const issuedAt = Date.UTC(2026, 8, 26);
  const { pass } = issuePass(claims, SECRET, issuedAt);
  const later = issuedAt + (PASS_TTL_SECONDS + 1) * 1000;
  assert.equal(readPass(pass, SECRET, { now: later }), null);
  assert.equal(readPass(pass, SECRET, { now: later, allowExpired: true }).sub, 'sub_123');
});

test('garbage is rejected without throwing', () => {
  for (const junk of [undefined, null, '', 'abc', 'a.b', '..', 42]) {
    assert.equal(readPass(junk, SECRET), null);
  }
});

test('the OpenRouter key survives encryption and needs the right secret', () => {
  // Assembled at runtime: a literal key-shaped string trips GitHub's secret scanning.
  const key = ['sk-or-v1', 'f'.repeat(64)].join('-');
  const blob = encryptSecret(key, SECRET);
  assert.ok(!blob.includes('sk-or'));
  assert.ok(blob.length < 500, 'fits in a Stripe metadata value');
  assert.equal(decryptSecret(blob, SECRET), key);
  assert.throws(() => decryptSecret(blob, 'wrong-secret-0123456789abcdef0123'));
  assert.notEqual(encryptSecret(key, SECRET), blob, 'fresh IV every time');
});
