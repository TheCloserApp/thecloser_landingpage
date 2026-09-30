// Pro transcription: /api/stt-token hands a Pro app a short-lived xAI token
// for Grok Transcribe 2, never the server's XAI_API_KEY. xAI is a fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PASS_SECRET ??= 'test-secret-that-is-long-enough-0123456789abcdef';
// Assembled at runtime: a literal key-shaped string trips GitHub's secret scanning.
const XAI_KEY = ['xai', 'k'.repeat(40)].join('-');

const calls = [];
let reply = () => Response.json({ value: 'ephemeral-token', expires_at: 1_900_000_000 });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), auth: init.headers?.Authorization, body: JSON.parse(init.body ?? '{}') });
  return reply();
};

const { POST } = await import('../api/stt-token.js');
const { issuePass } = await import('../api/_lib/pass.js');

const device = 'd'.repeat(64);
const { pass } = issuePass({ sub: 's', dev: device, plan: 'pro', orh: 'h', ork: 'k' }, process.env.PASS_SECRET);
const ask = (headers) => POST(new Request('https://example.test', { method: 'POST', headers }));

test('a Pro pass gets a short-lived token, never the key', async () => {
  process.env.XAI_API_KEY = XAI_KEY;
  const response = await ask({ authorization: `Bearer ${pass}`, 'x-device': device });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { token: 'ephemeral-token', expiresAt: 1_900_000_000, model: 'grok-voice-transcribe-2.0' });
  assert.ok(!JSON.stringify(body).includes(XAI_KEY), 'the key is not in the reply');
  const call = calls.at(-1);
  assert.equal(call.url, 'https://api.x.ai/v1/realtime/client_secrets');
  assert.equal(call.auth, `Bearer ${XAI_KEY}`);
  assert.deepEqual(call.body, { expires_after: { seconds: 300 } });
});

test('the nested client_secret shape works too', async () => {
  process.env.XAI_API_KEY = XAI_KEY;
  reply = () => Response.json({ client_secret: { value: 'nested-token', expires_at: 1_900_000_100 } });
  const body = await (await ask({ authorization: `Bearer ${pass}`, 'x-device': device })).json();
  assert.equal(body.token, 'nested-token');
  assert.equal(body.expiresAt, 1_900_000_100);
});

test('no pass, or another device, gets nothing', async () => {
  process.env.XAI_API_KEY = XAI_KEY;
  const before = calls.length;
  assert.equal((await ask({ 'x-device': device })).status, 401);
  assert.equal((await ask({ authorization: `Bearer ${pass}`, 'x-device': 'e'.repeat(64) })).status, 401);
  assert.equal(calls.length, before, 'xAI was never asked');
});

test('without XAI_API_KEY, or when xAI refuses, the app is told to fall back', async () => {
  delete process.env.XAI_API_KEY;
  const off = await ask({ authorization: `Bearer ${pass}`, 'x-device': device });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).error, 'stt_not_configured');

  process.env.XAI_API_KEY = XAI_KEY;
  reply = () => new Response('nope', { status: 401 });
  const refused = await ask({ authorization: `Bearer ${pass}`, 'x-device': device });
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error, 'stt_unavailable');
});
