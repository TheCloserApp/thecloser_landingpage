// Plans and settings shared by the API functions.
//
// Model ids are OpenRouter ids (the app strips its "openrouter/" prefix
// before sending). Allowances are monthly USD caps, enforced by OpenRouter
// on each subscriber's own key.

const STANDARD_MODELS = [
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.4-mini',
  'google/gemini-3.8-flash',
  'google/gemini-3.5-flash-lite',
  'x-ai/grok-4.7',
  'moonshotai/kimi-k2.6',
];

const PREMIUM_MODELS = [
  'anthropic/claude-opus-5.5',
  'anthropic/claude-fable-5.1',
  'openai/gpt-5.5',
];

export const PLANS = {
  pro:     { name: 'Pro',     lookupKey: 'pro_monthly',     allowanceUSD: 8,  models: STANDARD_MODELS },
  pro_max: { name: 'Pro Max', lookupKey: 'pro_max_monthly', allowanceUSD: 20, models: [...STANDARD_MODELS, ...PREMIUM_MODELS] },
};

export function planForLookupKey(lookupKey) {
  return Object.keys(PLANS).find((plan) => PLANS[plan].lookupKey === lookupKey) ?? null;
}

export const SITE_URL = process.env.SITE_URL ?? 'https://www.thecloser.tech';

/** The app's anonymous Mac fingerprint: a SHA-256 hex digest. */
export const DEVICE_PATTERN = /^[a-f0-9]{64}$/;

export class ConfigError extends Error {
  constructor(setting) {
    super(`Missing environment variable ${setting}`);
    this.setting = setting;
  }
}

export function env(name) {
  const value = process.env[name];
  if (!value) throw new ConfigError(name);
  return value;
}
