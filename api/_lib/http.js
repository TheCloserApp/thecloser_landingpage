export function json(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export class BadRequest extends Error {}

/** Parses a JSON body, refusing anything larger than `maxBytes`. */
export async function readJSON(request, maxBytes = 64 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new BadRequest('body_too_large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new BadRequest('invalid_json');
  }
}

export function bearer(request) {
  return (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
}

import { ConfigError } from './config.js';

/**
 * Wraps a handler: bad input answers 400; failures answer 500 with a
 * category that is safe to show (a missing setting's name, or Stripe's
 * error type and code, never a key or message), plus a full log line.
 */
export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (error) {
      if (error instanceof BadRequest) return json(400, { error: error.message });
      console.error(error);
      return json(500, describeFailure(error));
    }
  };
}

export function describeFailure(error) {
  if (error instanceof ConfigError) return { error: 'not_configured', setting: error.setting };
  if (typeof error?.type === 'string' && error.type.startsWith('Stripe')) {
    return { error: 'stripe_error', type: error.type, code: error.code ?? null };
  }
  return { error: 'server_error' };
}
