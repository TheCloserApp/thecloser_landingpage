// GET /api/usage  (Authorization: Bearer <pass>)
//   → { limitUSD, remainingUSD, usedThisMonthUSD }
// Powers the app's "X% of this month's allowance left".

import { env } from './_lib/config.js';
import { bearer, handle, json } from './_lib/http.js';
import { keyUsage } from './_lib/openrouter.js';
import { readPass } from './_lib/pass.js';

export const GET = handle(async (request) => {
  const claims = readPass(bearer(request), env('PASS_SECRET'));
  if (!claims) return json(401, { error: 'pass_expired' });
  return json(200, await keyUsage(claims.orh));
});
