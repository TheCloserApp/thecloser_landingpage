// POST /api/model-request  { model, note?, plan?, source?, website? }  →  { ok: true }
// "Request a model" from the website form (which the app links to). Each
// request is saved as a small JSON file in the project's private Vercel
// Blob store, under model-requests/. Nothing identifies who sent it: no
// email, no IP. `website` is a honeypot field that people never see; bots
// that fill it in get a normal answer and nothing is saved.

import { put } from '@vercel/blob';
import { env } from './_lib/config.js';
import { BadRequest, handle, json, readJSON } from './_lib/http.js';

const PLANS = new Set(['pro', 'pro_max', 'own_keys']);
const SOURCES = new Set(['app', 'web']);

/** Trimmed text of at most `max` characters, or '' for anything that isn't a string. */
function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export const POST = handle(async (request) => {
  const body = await readJSON(request, 8 * 1024);
  if (typeof body !== 'object' || body === null) throw new BadRequest('invalid_json');
  if (text(body.website, 200)) return json(200, { ok: true });

  const model = text(body.model, 120);
  if (!model) throw new BadRequest('model_required');
  const record = {
    model,
    note: text(body.note, 1000),
    plan: PLANS.has(body.plan) ? body.plan : null,
    source: SOURCES.has(body.source) ? body.source : 'web',
    receivedAt: new Date().toISOString(),
  };

  const day = record.receivedAt.slice(0, 10);
  await put(`model-requests/${day}/request.json`, JSON.stringify(record, null, 2), {
    access: 'private',
    addRandomSuffix: true,
    contentType: 'application/json',
    token: env('BLOB_READ_WRITE_TOKEN'),
  });
  return json(200, { ok: true });
});
