// Pro transcription: /api/stt-token hands a Pro app a short-lived token for
// Grok Transcribe 2 or ElevenLabs Scribe, never the server's keys. xAI and
// ElevenLabs are fakes.

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PASS_SECRET ??= 'test-secret-that-is-long-enough-0123456789abcdef';
// Assembled at runtime: a literal key-shaped string trips GitHub's secret scanning.
const XAI_KEY = ['xai', 'k'.repeat(40)].join('-');
const ELEVEN_KEY = ['sk', 'e'.repeat(40)].join('_');

const calls = [];
let reply = () => Response.json({ value: 'ephemeral-token', expires_at: 1_900_000_000 });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), auth: init.headers?.Authorization, xi: init.headers?.['xi-api-key'], body: JSON.parse(init.body ?? '{}') });
  return reply();
};

const { POST } = await import('../api/stt-token.js');
const { issuePass } = await import('../api/_lib/pass.js');

const device = 'd'.repeat(64);
const { pass } = issuePass({ sub: 's', dev: device, plan: 'pro', orh: 'h', ork: 'k' }, process.env.PASS_SECRET);
const ask = (headers, body) => POST(new Request('https://example.test', { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined }));

test('a Pro pass gets a short-lived token, never the key', async () => {
  process.env.XAI_API_KEY = XAI_KEY;
  const response = await ask({ authorization: `Bearer ${pass}`, 'x-device': device });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { token: 'ephemeral-token', expiresAt: 1_900_000_000, provider: 'grok', model: 'grok-voice-transcribe-2.0' });
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

test('ElevenLabs: a single-use Scribe token, never the key', async () => {
  process.env.ELEVENLABS_API_KEY = ELEVEN_KEY;
  reply = () => Response.json({ token: 'sutkn_single_use' });
  const auth = { authorization: `Bearer ${pass}`, 'x-device': device };
  const response = await ask(auth, { provider: 'elevenlabs' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.token, 'sutkn_single_use');
  assert.equal(body.provider, 'elevenlabs');
  assert.ok(body.expiresAt > Date.now() / 1000 + 800, 'lasts ElevenLabs\' 15 minutes');
  assert.ok(!JSON.stringify(body).includes(ELEVEN_KEY), 'the key is not in the reply');
  const call = calls.at(-1);
  assert.equal(call.url, 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
  assert.equal(call.xi, ELEVEN_KEY);

  delete process.env.ELEVENLABS_API_KEY;
  assert.equal((await ask(auth, { provider: 'elevenlabs' })).status, 503);
  assert.equal((await ask(auth, { provider: 'deepgram' })).status, 400);
});
