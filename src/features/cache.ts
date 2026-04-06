/**
 * XFetch - Universal Fetch Client
 * Author: Anwar Ramadan
 * Company: AR-Coder Company
 */

// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Cache System
//
// Provides two cache backends:
//   • MemoryCache       — Map-based, process-lifetime, SSR/browser safe
//   • LocalStorageCache — Browser-only, persisted across sessions
//
// CacheManager wraps both and adds:
//   • Request deduplication (in-flight promise sharing)
//   • TTL-based invalidation
//   • Manual invalidation helpers
// ─────────────────────────────────────────────────────────────────────────────

import type { XFetchResponse, CacheOptions } from '../utils/types.js';
import { isServer } from '../utils/helpers.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: XFetchResponse<T>;
  expiresAt: number; // Unix ms timestamp
}

// ─── Memory Cache ─────────────────────────────────────────────────────────────

/**
 * Simple Map-based in-memory cache.
 * Entries survive for as long as the process/tab is alive.
 *
 * Note: `size` reports the total number of stored entries including
 * entries that have expired but not yet been evicted (lazy eviction on `get`).
 * Call `prune()` to force-evict all expired entries.
 */
export class MemoryCache {
  private readonly store = new Map<string, CacheEntry>();

  get<T = unknown>(key: string): XFetchResponse<T> | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    // Lazy eviction: remove expired entries on read
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.data;
  }

  set<T = unknown>(key: string, value: XFetchResponse<T>, ttl: number): void {
    this.store.set(key, {
      data: value as XFetchResponse,
      expiresAt: Date.now() + ttl,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Removes all entries whose key starts with the given prefix. */
  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Force-evicts all entries that have passed their TTL.
   * Useful for freeing memory proactively; not required for correctness.
   */
  prune(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  clear(): void {
    this.store.clear();
  }

  /** Total number of stored entries (including not-yet-evicted expired entries). */
  get size(): number {
    return this.store.size;
  }
}

// ─── LocalStorage Cache ───────────────────────────────────────────────────────

const LS_PREFIX = '__xfetch__';

/**
 * LocalStorage-backed cache.
 * SSR-safe — all methods are no-ops when running on the server.
 * Serializes entries as JSON; silently ignores storage quota errors.
 */
export class LocalStorageCache {
  private readonly prefix: string;

  constructor(prefix = LS_PREFIX) {
    this.prefix = prefix;
  }

  private key(cacheKey: string): string {
    return `${this.prefix}${cacheKey}`;
  }

  get<T = unknown>(key: string): XFetchResponse<T> | null {
    if (isServer) return null;

    try {
      const raw = localStorage.getItem(this.key(key));
      if (!raw) return null;

      const entry = JSON.parse(raw) as CacheEntry<T>;

      if (Date.now() > entry.expiresAt) {
        localStorage.removeItem(this.key(key));
        return null;
      }

      return entry.data;
    } catch {
      return null;
    }
  }

  set<T = unknown>(key: string, value: XFetchResponse<T>, ttl: number): void {
    if (isServer) return;

    try {
      const entry: CacheEntry<T> = {
        data: value,
        expiresAt: Date.now() + ttl,
      };
      localStorage.setItem(this.key(key), JSON.stringify(entry));
    } catch {
      // Quota exceeded or private browsing — silently ignore
    }
  }

  delete(key: string): void {
    if (isServer) return;
    try {
      localStorage.removeItem(this.key(key));
    } catch { /* ignore */ }
  }

  deleteByPrefix(prefix: string): void {
    if (isServer) return;
    try {
      const fullPrefix = this.key(prefix);
      // Iterate backwards to avoid index shift when removing items
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(fullPrefix)) {
          localStorage.removeItem(k);
        }
      }
    } catch { /* ignore */ }
  }

  clear(): void {
    if (isServer) return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(this.prefix)) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }
}

// ─── Cache Manager ────────────────────────────────────────────────────────────

const DEFAULT_MEMORY_TTL = 5 * 60 * 1000;   // 5 minutes
const DEFAULT_LS_TTL     = 30 * 60 * 1000;  // 30 minutes

/**
 * CacheManager
 *
 * Unified caching interface that handles:
 *  1. Reading from the appropriate backend
 *  2. Writing to the appropriate backend
 *  3. Request deduplication — concurrent identical requests share one Promise
 *
 * @example
 * ```ts
 * const cache = new CacheManager();
 * const response = await cache.getOrFetch(key, options, () => makeRequest());
 * ```
 */
export class CacheManager {
  private readonly memory = new MemoryCache();
  private readonly ls     = new LocalStorageCache();

  /**
   * In-flight request map — prevents duplicate simultaneous requests.
   * Key → pending Promise<XFetchResponse>
   */
  private readonly inFlight = new Map<string, Promise<XFetchResponse>>();

  /**
   * Try to get a cached response, or execute `fetcher` and cache the result.
   *
   * @param key      Unique cache key for this request
   * @param options  CacheOptions controlling storage, TTL, bypass
   * @param fetcher  The actual fetch function to call on a cache miss
   */
  async getOrFetch<T = unknown>(
    key: string,
    options: CacheOptions,
    fetcher: () => Promise<XFetchResponse<T>>
  ): Promise<XFetchResponse<T>> {
    const storage = options.storage ?? 'memory';

    // BUG-3 FIX: single bypass/none early-return, no duplicate guard below
    if (storage === 'none' || options.bypass) {
      return fetcher();
    }

    // Cache read — may be a hit
    const cached = this.read<T>(key, storage);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    // Deduplication — reuse in-flight promise for identical concurrent requests
    const existing = this.inFlight.get(key) as Promise<XFetchResponse<T>> | undefined;
    if (existing) {
      return existing;
    }

    // Execute fetch, cache the result, clean up in-flight
    const ttl =
      options.ttl ??
      (storage === 'localStorage' ? DEFAULT_LS_TTL : DEFAULT_MEMORY_TTL);

    const promise = fetcher()
      .then((result) => {
        this.write(key, result, storage, ttl);
        this.inFlight.delete(key);
        return result;
      })
      .catch((err: unknown) => {
        // Always clean up in-flight on failure so the next caller retries
        this.inFlight.delete(key);
        throw err;
      });

    this.inFlight.set(key, promise as Promise<XFetchResponse>);
    return promise;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private read<T>(
    key: string,
    storage: NonNullable<CacheOptions['storage']>
  ): XFetchResponse<T> | null {
    switch (storage) {
      case 'memory':
        return this.memory.get<T>(key);
      case 'localStorage':
        // Check localStorage first, fall back to memory (written on every store)
        return this.ls.get<T>(key) ?? this.memory.get<T>(key);
      default:
        return null;
    }
  }

  private write<T>(
    key: string,
    value: XFetchResponse<T>,
    storage: NonNullable<CacheOptions['storage']>,
    ttl: number
  ): void {
    // Always write to memory for fastest subsequent reads
    this.memory.set(key, value, ttl);
    if (storage === 'localStorage') {
      this.ls.set(key, value, ttl);
    }
  }

  // ── Public invalidation API ───────────────────────────────────────────────

  /** Remove a specific entry from all caches. */
  invalidate(key: string): void {
    this.memory.delete(key);
    this.ls.delete(key);
  }

  /** Remove all entries from all caches. */
  clear(): void {
    this.memory.clear();
    this.ls.clear();
  }

  /** Remove entries whose key starts with a given prefix. */
  invalidateByPrefix(prefix: string): void {
    this.memory.deleteByPrefix(prefix);
    this.ls.deleteByPrefix(prefix);
  }

  /** Evict all expired entries from the memory cache. Returns count evicted. */
  prune(): number {
    return this.memory.prune();
  }
}
