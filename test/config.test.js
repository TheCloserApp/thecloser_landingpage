import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_PATTERN, PLANS, planForLookupKey } from '../api/_lib/config.js';

test('lookup keys map back to plans', () => {
  assert.equal(planForLookupKey('pro_monthly'), 'pro');
  assert.equal(planForLookupKey('pro_max_monthly'), 'pro_max');
  assert.equal(planForLookupKey('something_else'), null);
  assert.equal(planForLookupKey(undefined), null);
});

test('Pro Max includes every Pro model and costs us more', () => {
  for (const model of PLANS.pro.models) assert.ok(PLANS.pro_max.models.includes(model), model);
  assert.ok(PLANS.pro_max.models.length > PLANS.pro.models.length);
  assert.ok(PLANS.pro_max.allowanceUSD > PLANS.pro.allowanceUSD);
});

test('the background model the app uses is in every plan', () => {
  for (const plan of Object.values(PLANS)) assert.ok(plan.models.includes('anthropic/claude-haiku-4.5'));
});

test('device fingerprints must be 64 lowercase hex characters', () => {
  assert.ok(DEVICE_PATTERN.test('0123456789abcdef'.repeat(4)));
  assert.ok(!DEVICE_PATTERN.test("x' OR metadata['device']:'y"), 'blocks search-query injection');
  assert.ok(!DEVICE_PATTERN.test('ABCDEF'.padEnd(64, '0')));
  assert.ok(!DEVICE_PATTERN.test(''));
});
