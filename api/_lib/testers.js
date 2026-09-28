// Tester access. Anyone with the tester code (TESTER_CODE) gets Pro on
// their device, paid from one shared OpenRouter key
// (TESTER_OPENROUTER_KEY). That key's own credit limit, set in OpenRouter,
// caps what all testers together can ever spend. No Stripe, no account.
//
// Ending the test: remove TESTER_CODE (tester passes stop renewing within
// the hour) or disable the key in OpenRouter (AI requests stop at once).

import { createHash, timingSafeEqual } from 'node:crypto';
import { PLANS } from './config.js';
import { encryptSecret, issuePass } from './pass.js';

/** The running test, or null when it isn't configured. */
export function testerProgram() {
  const code = process.env.TESTER_CODE?.trim();
  const key = process.env.TESTER_OPENROUTER_KEY?.trim();
  return code && key ? { code, key } : null;
}

/** Case, spaces and dashes don't matter: "closer-test 2026" = "CLOSERTEST2026". */
const normalize = (value) => value.toUpperCase().replace(/[\s-]+/g, '');

export function codeMatches(input, code) {
  if (typeof input !== 'string' || !input.trim()) return false;
  const digest = (value) => createHash('sha256').update(normalize(value)).digest();
  return timingSafeEqual(digest(input), digest(code));
}

/** A pass on Pro's models, paid from the shared key. `tst` marks it. */
export function testerPass(device, program, secret) {
  const plan = 'pro';
  const issued = issuePass(
    { sub: 'tester', dev: device, plan, orh: 'tester', ork: encryptSecret(program.key, secret), tst: 1 },
    secret,
  );
  return { ...issued, plan, models: PLANS[plan].models, tester: true };
}

/**
 * The shared key's credit limit and spend, from OpenRouter's GET /key.
 * Spend lags about a minute. `limitUSD` is null when the key has no limit,
 * which would leave testing uncapped, so callers refuse to use it then.
 */
export async function testerKeyStatus(key) {
  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`OpenRouter GET /key failed: ${response.status}`);
  const { data } = await response.json();
  const limit = Number(data.limit);
  return {
    limitUSD: data.limit === null || !(limit > 0) ? null : limit,
    usedUSD: Number(data.usage) || 0,
    remainingUSD: Math.max(0, Number(data.limit_remaining) || 0),
  };
}

/** The same shape /api/usage returns for subscribers, for the test budget. */
export function testerUsage(status) {
  const round = (value) => Math.round(value * 1e6) / 1e6;
  return {
    plan: 'pro',
    tester: true,
    allowanceUSD: status.limitUSD,
    usedUSD: round(status.usedUSD),
    remainingUSD: round(status.remainingUSD),
    usedFraction: Math.min(1, round(status.usedUSD / status.limitUSD)),
    periodEnd: null,
    renews: false,
  };
}
