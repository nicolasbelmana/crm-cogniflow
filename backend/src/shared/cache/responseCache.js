/**
 * Lightweight in-memory cache (Cache-Aside) for AI classification responses.
 *
 * Notes:
 * - Process-local only (good enough for single-node dev/small deployments).
 * - TTL-based eviction + lazy cleanup on reads.
 * - Tracks cache effectiveness counters for reporting.
 */
export function createResponseCache({ enabled = true, ttlSeconds = 24 * 60 * 60 } = {}) {
  const ttlMs = Math.max(1, Number(ttlSeconds) || 24 * 60 * 60) * 1000;
  const store = new Map();
  const isDev = process.env.NODE_ENV !== 'production';

  const stats = {
    cache_hit: 0,
    cache_miss: 0,
    cache_saved_tokens: 0,
    cache_saved_calls: 0,
    cache_saved_usd: 0,
  };

  function pruneExpiredEntry(key, entry, nowMs) {
    if (entry.expiresAt <= nowMs) {
      store.delete(key);
      return true;
    }

    return false;
  }

  return {
    get(key) {
      if (!enabled) {
        return null;
      }

      const entry = store.get(key);
      if (!entry) {
        stats.cache_miss += 1;
        if (isDev) {
          console.debug('[responseCache] Cache Miss', { key });
        }
        return null;
      }

      if (pruneExpiredEntry(key, entry, Date.now())) {
        stats.cache_miss += 1;
        if (isDev) {
          console.debug('[responseCache] Cache Miss (expired)', { key });
        }
        return null;
      }

      stats.cache_hit += 1;
      stats.cache_saved_calls += 1;
      stats.cache_saved_tokens += entry.estimatedTokens;
      stats.cache_saved_usd += entry.estimatedCostUsd;
      if (isDev) {
        console.debug('[responseCache] Cache Hit', {
          key,
          estimatedTokens: entry.estimatedTokens,
          estimatedCostUsd: entry.estimatedCostUsd,
        });
      }
      return entry.value;
    },

    set(key, value, { estimatedTokens = 0, estimatedCostUsd = 0 } = {}) {
      if (!enabled) {
        return;
      }

      store.set(key, {
        value,
        estimatedTokens: Math.max(0, Number(estimatedTokens) || 0),
        estimatedCostUsd: Math.max(0, Number(estimatedCostUsd) || 0),
        expiresAt: Date.now() + ttlMs,
      });
    },

    getStats() {
      return {
        ...stats,
        enabled,
        ttl_seconds: ttlMs / 1000,
        entries: store.size,
      };
    },

    clear() {
      store.clear();
    },
  };
}
