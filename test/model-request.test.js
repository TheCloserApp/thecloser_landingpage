// "Request a model" saves one private JSON file per request, with nothing
// that identifies the sender. The Blob store is replaced by a fake.

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

process.env.BLOB_READ_WRITE_TOKEN = 'unused';

const saved = [];
mock.module('@vercel/blob', {
  namedExports: {
    put: async (pathname, body, options) => {
      saved.push({ pathname, record: JSON.parse(body), options });
      return { pathname };
    },
  },
});

const { POST } = await import('../api/model-request.js');
const send = (body) => POST(new Request('https://example.test', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'x-forwarded-for': '203.0.113.9' },
}));

test('a request is saved privately, without who sent it', async () => {
  const response = await send({ model: '  DeepSeek V4 ', note: 'coding rounds', plan: 'pro', source: 'app' });
  assert.equal(response.status, 200);
  assert.equal(saved.length, 1);
  const [{ pathname, record, options }] = saved;
  assert.match(pathname, /^model-requests\/\d{4}-\d{2}-\d{2}\/request\.json$/);
  assert.equal(options.access, 'private');
  assert.equal(options.addRandomSuffix, true);
  assert.deepEqual(Object.keys(record).sort(), ['model', 'note', 'plan', 'receivedAt', 'source']);
  assert.equal(record.model, 'DeepSeek V4');
  assert.equal(record.plan, 'pro');
  assert.ok(!JSON.stringify(record).includes('203.0.113.9'));
});

test('unknown plans and sources are not stored as given', async () => {
  saved.length = 0;
  await send({ model: 'Llama 5', plan: 'enterprise', source: '<script>' });
  assert.equal(saved[0].record.plan, null);
  assert.equal(saved[0].record.source, 'web');
});

test('a missing model is refused, and the honeypot saves nothing', async () => {
  saved.length = 0;
  assert.equal((await send({ note: 'no model' })).status, 400);
  assert.equal((await send(null)).status, 400);
  assert.equal((await send({ model: 'x', website: 'http://spam.example' })).status, 200);
  assert.equal(saved.length, 0);
});

test('long text is cut short', async () => {
  saved.length = 0;
  await send({ model: 'm'.repeat(500), note: 'n'.repeat(5000) });
  assert.equal(saved[0].record.model.length, 120);
  assert.equal(saved[0].record.note.length, 1000);
});
