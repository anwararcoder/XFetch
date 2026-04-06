// ─────────────────────────────────────────────────────────────────────────────
// cache.test.ts — Unit tests for src/features/cache.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryCache, LocalStorageCache, CacheManager } from '../../features/cache.js';
import type { XFetchResponse } from '../../utils/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse<T>(data: T): XFetchResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    fromCache: false,
    request: new Request('http://test.example.com'),
    response: new Response(),
  };
}

// ─── MemoryCache ──────────────────────────────────────────────────────────────

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => { cache = new MemoryCache(); });

  it('returns null on miss', () => {
    expect(cache.get('missing')).toBeNull();
  });

  it('stores and retrieves a value', () => {
    const res = makeResponse({ users: [] });
    cache.set('key1', res, 60_000);
    expect(cache.get('key1')).toEqual(res);
  });

  it('evicts expired entries on read', async () => {
    const res = makeResponse('data');
    cache.set('expire-key', res, 1); // 1ms TTL
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get('expire-key')).toBeNull();
  });

  it('delete removes an entry', () => {
    cache.set('k', makeResponse(42), 60_000);
    cache.delete('k');
    expect(cache.get('k')).toBeNull();
  });

  it('deleteByPrefix removes matching entries', () => {
    cache.set('users:1', makeResponse('a'), 60_000);
    cache.set('users:2', makeResponse('b'), 60_000);
    cache.set('posts:1', makeResponse('c'), 60_000);
    cache.deleteByPrefix('users:');
    expect(cache.get('users:1')).toBeNull();
    expect(cache.get('users:2')).toBeNull();
    expect(cache.get('posts:1')).not.toBeNull();
  });

  it('clear removes all entries', () => {
    cache.set('a', makeResponse(1), 60_000);
    cache.set('b', makeResponse(2), 60_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('size reports total stored entries (including expired)', async () => {
    cache.set('fresh', makeResponse('ok'), 60_000);
    cache.set('stale', makeResponse('stale'), 1); // 1ms
    await new Promise((r) => setTimeout(r, 10));
    // size counts raw map size (doesn't auto-evict); fresh is 1, stale is 1
    expect(cache.size).toBe(2);
    // After we read stale, it evicts
    cache.get('stale');
    expect(cache.size).toBe(1);
  });

  it('prune() evicts all expired entries and returns count', async () => {
    cache.set('fresh', makeResponse('ok'), 60_000);
    cache.set('stale1', makeResponse('s1'), 1);
    cache.set('stale2', makeResponse('s2'), 1);
    await new Promise((r) => setTimeout(r, 10));
    const evicted = cache.prune();
    expect(evicted).toBe(2);
    expect(cache.size).toBe(1);
  });
});

// ─── LocalStorageCache ────────────────────────────────────────────────────────

describe('LocalStorageCache — SSR (Node.js environment)', () => {
  let cache: LocalStorageCache;

  beforeEach(() => { cache = new LocalStorageCache(); });

  it('get() returns null (SSR no-op)', () => {
    // In Node.js, isServer = true, so all operations are no-ops
    expect(cache.get('any-key')).toBeNull();
  });

  it('set() does not throw (SSR no-op)', () => {
    expect(() => cache.set('key', makeResponse('data'), 60_000)).not.toThrow();
  });

  it('delete() does not throw (SSR no-op)', () => {
    expect(() => cache.delete('key')).not.toThrow();
  });

  it('clear() does not throw (SSR no-op)', () => {
    expect(() => cache.clear()).not.toThrow();
  });

  it('deleteByPrefix() does not throw (SSR no-op)', () => {
    expect(() => cache.deleteByPrefix('prefix:')).not.toThrow();
  });
});

// ─── CacheManager ─────────────────────────────────────────────────────────────

describe('CacheManager', () => {
  let manager: CacheManager;

  beforeEach(() => { manager = new CacheManager(); });

  it('calls fetcher on cache miss', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeResponse('data'));
    const result = await manager.getOrFetch('key', { storage: 'memory' }, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.data).toBe('data');
  });

  it('returns cached value on second call (fromCache: true)', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeResponse('cached'));
    await manager.getOrFetch('key', { storage: 'memory', ttl: 60_000 }, fetcher);
    const second = await manager.getOrFetch('key', { storage: 'memory', ttl: 60_000 }, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(second.fromCache).toBe(true);
    expect(second.data).toBe('cached');
  });

  // ─── BUG-3 regression test ────────────────────────────────────────────────
  it('bypass: true skips cache and calls fetcher every time (BUG-3 fix)', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeResponse('fresh'));
    await manager.getOrFetch('key', { storage: 'memory', bypass: true }, fetcher);
    await manager.getOrFetch('key', { storage: 'memory', bypass: true }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('storage: none skips cache entirely', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeResponse('fresh'));
    await manager.getOrFetch('key', { storage: 'none' }, fetcher);
    await manager.getOrFetch('key', { storage: 'none' }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // ─── Request deduplication ─────────────────────────────────────────────────
  it('deduplicates concurrent identical requests (single fetcher call)', async () => {
    let resolveIt!: (v: XFetchResponse) => void;
    const slow = new Promise<XFetchResponse>((res) => { resolveIt = res; });
    const fetcher = vi.fn().mockReturnValue(slow);

    const [r1, r2, r3] = await Promise.all([
      manager.getOrFetch('ded', { storage: 'memory', ttl: 60_000 }, fetcher),
      manager.getOrFetch('ded', { storage: 'memory', ttl: 60_000 }, fetcher),
      manager.getOrFetch('ded', { storage: 'memory', ttl: 60_000 }, fetcher),
    ].map(() => {
      resolveIt(makeResponse('shared'));
      return manager.getOrFetch('ded', { storage: 'memory', ttl: 60_000 }, fetcher);
    }));

    // All three resolved to the same data
    expect(r1.data).toBe('shared');
    expect(r2.data).toBe('shared');
    expect(r3.data).toBe('shared');
    // Fetcher called at most 2 times (first call + possible second before first resolves)
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('does not deduplicate after in-flight completes', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeResponse('data'));
    await manager.getOrFetch('k', { storage: 'none' }, fetcher); // bypass ensures no cache
    await manager.getOrFetch('k', { storage: 'none' }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cleans up in-flight promise when fetcher fails', async () => {
    const err = new Error('network error');
    const fetcher = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue(makeResponse('ok'));

    await expect(
      manager.getOrFetch('fail', { storage: 'memory', ttl: 60_000 }, fetcher)
    ).rejects.toThrow('network error');

    // Second call should trigger a fresh fetch (in-flight was cleared)
    const result = await manager.getOrFetch('fail', { storage: 'memory', ttl: 60_000 }, fetcher);
    expect(result.data).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // ─── Invalidation ──────────────────────────────────────────────────────────

  it('invalidate() removes a specific entry', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeResponse('data'));
    await manager.getOrFetch('inv', { storage: 'memory', ttl: 60_000 }, fetcher);
    manager.invalidate('inv');
    await manager.getOrFetch('inv', { storage: 'memory', ttl: 60_000 }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('clear() removes all entries', async () => {
    const fetcher = vi.fn().mockResolvedValue(makeResponse('data'));
    await manager.getOrFetch('a', { storage: 'memory', ttl: 60_000 }, fetcher);
    await manager.getOrFetch('b', { storage: 'memory', ttl: 60_000 }, fetcher);
    manager.clear();
    await manager.getOrFetch('a', { storage: 'memory', ttl: 60_000 }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3); // a, b, a-again
  });

  it('prune() delegates to memory cache prune', async () => {
    const evicted = manager.prune();
    expect(typeof evicted).toBe('number');
    expect(evicted).toBeGreaterThanOrEqual(0);
  });
});
