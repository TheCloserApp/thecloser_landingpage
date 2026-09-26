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

/** Wraps a handler so bad input answers 400 and missing config 500, with a log line. */
export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (error) {
      if (error instanceof BadRequest) return json(400, { error: error.message });
      console.error(error);
      return json(500, { error: 'server_error' });
    }
  };
}
