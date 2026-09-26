// OpenRouter key management, with the management (provisioning) key.
// Each subscriber gets their own key with a monthly spending cap, which
// OpenRouter enforces and resets at the start of each UTC month.

import { env } from './config.js';

const API = 'https://openrouter.ai/api/v1';

async function manage(path, init = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('OPENROUTER_MANAGEMENT_KEY')}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`OpenRouter ${init.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/** Returns the key's hash (for later management) and the key itself (shown only once). */
export async function createKey({ name, limitUSD }) {
  const result = await manage('/keys', {
    method: 'POST',
    body: JSON.stringify({ name, limit: limitUSD, limit_reset: 'monthly' }),
  });
  return { hash: result.data.hash, key: result.key };
}

export async function updateKey(hash, fields) {
  await manage(`/keys/${encodeURIComponent(hash)}`, { method: 'PATCH', body: JSON.stringify(fields) });
}

export async function keyUsage(hash) {
  const { data } = await manage(`/keys/${encodeURIComponent(hash)}`);
  return { limitUSD: data.limit, remainingUSD: data.limit_remaining, usedThisMonthUSD: data.usage_monthly };
}
