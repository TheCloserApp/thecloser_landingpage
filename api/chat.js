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
  if (upstream.status === 402) {
    // Two different 402s. The subscriber's own key hit its cap: that's their
    // allowance, and the app says so. Or TheCloser's OpenRouter account is
    // out of credit ("limit_source": "openrouter_credits"): our problem, not
    // theirs, so they're told to try again and it's logged for us to top up.
    const text = await upstream.text();
    if (isAccountOutOfCredit(text)) {
      console.error('OpenRouter account is out of credit: add credits (or turn on auto top-up) at openrouter.ai/settings/credits');
      return new Response("TheCloser couldn't answer right now. Try again in a moment.", {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(text, { status: 402, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
});

/** OpenRouter's 402 when the account's balance, not the key's limit, can't cover the request. */
export function isAccountOutOfCredit(body) {
  try {
    return JSON.parse(body)?.error?.metadata?.limit_source === 'openrouter_credits';
  } catch {
    return false;
  }
}
