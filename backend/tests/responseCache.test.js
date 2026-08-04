import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponseCache } from '../src/shared/cache/responseCache.js';

test('responseCache stores values and tracks hit/miss stats', () => {
  const cache = createResponseCache({ enabled: true, ttlSeconds: 60 });

  const miss = cache.get('missing-key');
  assert.equal(miss, null);

  cache.set('k1', { classification: { id: 'c1' } }, { estimatedTokens: 123, estimatedCostUsd: 0.01 });
  const hit = cache.get('k1');

  assert.deepEqual(hit, { classification: { id: 'c1' } });

  const stats = cache.getStats();
  assert.equal(stats.cache_hit, 1);
  assert.equal(stats.cache_miss, 1);
  assert.equal(stats.cache_saved_calls, 1);
  assert.equal(stats.cache_saved_tokens, 123);
  assert.equal(stats.cache_saved_usd, 0.01);
});

test('responseCache disabled mode never stores and always returns null', () => {
  const cache = createResponseCache({ enabled: false, ttlSeconds: 60 });
  cache.set('k2', { anything: true });

  assert.equal(cache.get('k2'), null);

  const stats = cache.getStats();
  assert.equal(stats.cache_hit, 0);
  assert.equal(stats.cache_miss, 0);
  assert.equal(stats.entries, 0);
});
