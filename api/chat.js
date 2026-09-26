// POST /api/chat — OpenAI-compatible chat completions for Pro subscribers.
// Headers: Authorization: Bearer <pass>, X-Device: <fingerprint>.
// Checks the pass (a signature check, no lookups), limits models to the
// plan, and streams the request through OpenRouter with the subscriber's
// own capped key. OpenRouter answers 402 once the monthly cap is used up;
// that status is passed through for the app to explain.

import { PLANS, SITE_URL, env } from './_lib/config.js';
import { bearer, handle, json, readJSON } from './_lib/http.js';
import { decryptSecret, readPass } from './_lib/pass.js';

// Vercel caps request bodies at 4.5 MB; screenshots are the big part.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 4096;

export const POST = handle(async (request) => {
  const secret = env('PASS_SECRET');
  const claims = readPass(bearer(request), secret);
  if (!claims) return json(401, { error: 'pass_expired' });
  if (request.headers.get('x-device') !== claims.dev) return json(401, { error: 'wrong_device' });

  const body = await readJSON(request, MAX_BODY_BYTES);
  if (!PLANS[claims.plan]?.models.includes(body.model)) return json(403, { error: 'model_not_in_plan' });
  body.max_tokens = Math.min(Number(body.max_tokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
  delete body.max_completion_tokens;

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${decryptSecret(claims.ork, secret)}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL,
      'X-Title': 'TheCloser',
    },
    body: JSON.stringify(body),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
});
