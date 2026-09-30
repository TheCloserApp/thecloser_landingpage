// POST /api/stt-token — a short-lived transcription token for Pro.
// Headers: Authorization: Bearer <pass>, X-Device: <fingerprint>.
// Body (optional): { provider: "grok" | "elevenlabs" }, default "grok".
//   200 { token, expiresAt, provider, model }   expiresAt in Unix seconds
//   400 an unknown provider
//   401 the pass expired or belongs to another device
//   503 that provider isn't set up (no key) or refused
// Pro (subscribers and testers) transcribes the interviewer with Grok
// Transcribe 2 or ElevenLabs Scribe, their pick. The app opens the
// WebSocket itself, so it needs a credential; this one lasts minutes (and
// ElevenLabs' works once), and our keys never leave the server. The app
// asks again for each connection.
//   Grok: Authorization: Bearer <token> on wss://api.x.ai/v1/stt
//   ElevenLabs: ?token=<token> on wss://api.elevenlabs.io/v1/speech-to-text/realtime

import { env } from './_lib/config.js';
import { BadRequest, bearer, handle, json, readJSON } from './_lib/http.js';
import { readPass } from './_lib/pass.js';

export const STT_MODEL = 'grok-voice-transcribe-2.0';
const GROK_TOKEN_SECONDS = 300;
const ELEVENLABS_TOKEN_SECONDS = 900;   // ElevenLabs' fixed lifetime

export const POST = handle(async (request) => {
  const claims = readPass(bearer(request), env('PASS_SECRET'));
  if (!claims) return json(401, { error: 'pass_expired' });
  if (request.headers.get('x-device') !== claims.dev) return json(401, { error: 'wrong_device' });
  const { provider = 'grok' } = await readJSON(request);
  if (provider === 'elevenlabs') return elevenLabsToken();
  if (provider === 'grok') return grokToken();
  throw new BadRequest('unknown_provider');
});

async function grokToken() {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return json(503, { error: 'stt_not_configured' });
  const upstream = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: { seconds: GROK_TOKEN_SECONDS } }),
  });
  if (!upstream.ok) {
    console.error(`xAI client_secrets failed: ${upstream.status}`);
    return json(503, { error: 'stt_unavailable' });
  }
  const data = await upstream.json();
  // Accept either shape xAI may return: { value, expires_at } or { client_secret: { value, expires_at } }.
  const secret = data.client_secret ?? data;
  const token = secret.value ?? secret.token;
  if (typeof token !== 'string' || !token) {
    console.error('xAI client_secrets returned no token');
    return json(503, { error: 'stt_unavailable' });
  }
  const expiresAt = Number(secret.expires_at) || Math.floor(Date.now() / 1000) + GROK_TOKEN_SECONDS;
  return json(200, { token, expiresAt, provider: 'grok', model: STT_MODEL });
}

async function elevenLabsToken() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) return json(503, { error: 'stt_not_configured' });
  const upstream = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', {
    method: 'POST',
    headers: { 'xi-api-key': key },
  });
  if (!upstream.ok) {
    console.error(`ElevenLabs single-use-token failed: ${upstream.status}`);
    return json(503, { error: 'stt_unavailable' });
  }
  const { token } = await upstream.json();
  if (typeof token !== 'string' || !token) {
    console.error('ElevenLabs single-use-token returned no token');
    return json(503, { error: 'stt_unavailable' });
  }
  return json(200, {
    token,
    expiresAt: Math.floor(Date.now() / 1000) + ELEVENLABS_TOKEN_SECONDS,
    provider: 'elevenlabs',
    model: 'scribe_v2_realtime',
  });
}
