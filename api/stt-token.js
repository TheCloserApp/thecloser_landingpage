// POST /api/stt-token — a short-lived xAI token for Pro transcription.
// Headers: Authorization: Bearer <pass>, X-Device: <fingerprint>.
//   200 { token, expiresAt, model }   expiresAt in Unix seconds
//   401 the pass expired or belongs to another device
//   503 xAI isn't set up (no XAI_API_KEY) or refused
// Pro (subscribers and testers) transcribes the interviewer with Grok
// Transcribe 2. The app opens the WebSocket to wss://api.x.ai/v1/stt
// itself, so it needs a credential; this one lasts a few minutes, and our
// XAI_API_KEY never leaves the server. The app asks again for each
// connection.

import { env } from './_lib/config.js';
import { bearer, handle, json } from './_lib/http.js';
import { readPass } from './_lib/pass.js';

export const STT_MODEL = 'grok-voice-transcribe-2.0';
const TOKEN_SECONDS = 300;

export const POST = handle(async (request) => {
  const claims = readPass(bearer(request), env('PASS_SECRET'));
  if (!claims) return json(401, { error: 'pass_expired' });
  if (request.headers.get('x-device') !== claims.dev) return json(401, { error: 'wrong_device' });

  const key = process.env.XAI_API_KEY?.trim();
  if (!key) return json(503, { error: 'stt_not_configured' });

  const upstream = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: { seconds: TOKEN_SECONDS } }),
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
  const expiresAt = Number(secret.expires_at) || Math.floor(Date.now() / 1000) + TOKEN_SECONDS;
  return json(200, { token, expiresAt, model: STT_MODEL });
});
