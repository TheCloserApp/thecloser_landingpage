// GET /api/models  →  { plans: { pro: {...}, pro_max: {...} } }
// Public: which models and monthly allowance each plan includes, so the app
// can show plans and add models without shipping an update.

import { PLANS } from './_lib/config.js';
import { json } from './_lib/http.js';

export function GET() {
  const plans = Object.fromEntries(
    Object.entries(PLANS).map(([id, { name, allowanceUSD, models }]) => [id, { name, allowanceUSD, models }]),
  );
  return json(200, { plans });
}
