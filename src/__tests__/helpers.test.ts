// ─────────────────────────────────────────────────────────────────────────────
// helpers.test.ts — Unit tests for src/utils/helpers.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildURL,
  appendParams,
  mergeHeaders,
  headersToRecord,
  isJSONBody,
  prepareBody,
  generateCacheKey,
  sleep,
  createTimeoutSignal,
  combineSignals,
  parseResponseBody,
  isServer,
  isBrowser,
} from '../../utils/helpers.js';

// ─── buildURL ─────────────────────────────────────────────────────────────────

describe('buildURL', () => {
  it('joins base and path', () => {
    expect(buildURL('https://api.example.com', '/users')).toBe('https://api.example.com/users');
  });

  it('strips trailing slash from base', () => {
    expect(buildURL('https://api.example.com/', '/users')).toBe('https://api.example.com/users');
  });

  it('adds leading slash to path if missing', () => {
    expect(buildURL('https://api.example.com', 'users')).toBe('https://api.example.com/users');
  });

  it('returns path unchanged when base is empty', () => {
    expect(buildURL('', '/users')).toBe('/users');
  });

  it('handles double slashes gracefully', () => {
    expect(buildURL('https://api.example.com/', '/users')).toBe('https://api.example.com/users');
  });
});

// ─── appendParams ─────────────────────────────────────────────────────────────

describe('appendParams', () => {
  it('returns url unchanged when no params', () => {
    expect(appendParams('/users')).toBe('/users');
    expect(appendParams('/users', {})).toBe('/users');
  });

  it('appends single param', () => {
    expect(appendParams('/users', { page: 1 })).toBe('/users?page=1');
  });

  it('appends multiple params', () => {
    const result = appendParams('/users', { page: 1, limit: 10 });
    expect(result).toBe('/users?page=1&limit=10');
  });

  it('skips null and undefined values', () => {
    const result = appendParams('/users', { page: 1, filter: null, sort: undefined });
    expect(result).toBe('/users?page=1');
  });

  it('encodes special characters', () => {
    expect(appendParams('/search', { q: 'hello world' })).toBe('/search?q=hello%20world');
  });

  it('appends to existing query string', () => {
    expect(appendParams('/users?active=true', { page: 2 })).toBe('/users?active=true&page=2');
  });

  it('handles boolean params', () => {
    expect(appendParams('/users', { active: true, deleted: false })).toBe('/users?active=true&deleted=false');
  });
});

// ─── mergeHeaders ─────────────────────────────────────────────────────────────

describe('mergeHeaders', () => {
  it('returns empty object when called with no args', () => {
    expect(mergeHeaders()).toEqual({});
  });

  it('merges two header objects, later wins', () => {
    const result = mergeHeaders({ 'x-foo': 'a' }, { 'x-foo': 'b' });
    expect(result).toEqual({ 'x-foo': 'b' });
  });

  it('normalizes header names to lowercase', () => {
    const result = mergeHeaders({ 'Content-Type': 'application/json' });
    expect(result['content-type']).toBe('application/json');
    expect(result['Content-Type']).toBeUndefined();
  });

  it('skips null and undefined sources', () => {
    const result = mergeHeaders(null, undefined, { 'x-a': '1' });
    expect(result).toEqual({ 'x-a': '1' });
  });
});

// ─── headersToRecord ──────────────────────────────────────────────────────────

describe('headersToRecord', () => {
  it('converts Headers instance to plain object', () => {
    const headers = new Headers({ 'content-type': 'application/json', 'x-id': '42' });
    const record = headersToRecord(headers);
    expect(record['content-type']).toBe('application/json');
    expect(record['x-id']).toBe('42');
  });

  it('returns empty object for empty Headers', () => {
    expect(headersToRecord(new Headers())).toEqual({});
  });
});

// ─── isJSONBody ───────────────────────────────────────────────────────────────

describe('isJSONBody', () => {
  it('returns true for plain objects', () => {
    expect(isJSONBody({ name: 'test' })).toBe(true);
  });

  it('returns true for arrays', () => {
    expect(isJSONBody([1, 2, 3])).toBe(true);
  });

  it('returns false for FormData', () => {
    expect(isJSONBody(new FormData())).toBe(false);
  });

  it('returns false for Blob', () => {
    expect(isJSONBody(new Blob())).toBe(false);
  });

  it('returns false for ArrayBuffer', () => {
    expect(isJSONBody(new ArrayBuffer(8))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isJSONBody(null)).toBe(false);
  });

  it('returns false for URLSearchParams', () => {
    expect(isJSONBody(new URLSearchParams())).toBe(false);
  });
});

// ─── prepareBody ──────────────────────────────────────────────────────────────

describe('prepareBody', () => {
  it('returns null for undefined body', () => {
    const { serialized, extraHeaders } = prepareBody(undefined);
    expect(serialized).toBeNull();
    expect(extraHeaders).toEqual({});
  });

  it('returns null for null body', () => {
    const { serialized } = prepareBody(null);
    expect(serialized).toBeNull();
  });

  it('JSON-serializes plain objects and sets content-type', () => {
    const { serialized, extraHeaders } = prepareBody({ foo: 'bar' });
    expect(serialized).toBe('{"foo":"bar"}');
    expect(extraHeaders['content-type']).toBe('application/json');
  });

  it('passes FormData through without content-type', () => {
    const fd = new FormData();
    const { serialized, extraHeaders } = prepareBody(fd);
    expect(serialized).toBe(fd);
    expect(extraHeaders).toEqual({});
  });
});

// ─── generateCacheKey ─────────────────────────────────────────────────────────

describe('generateCacheKey', () => {
  it('generates a key with method and url', () => {
    const key = generateCacheKey('GET', '/users');
    expect(key).toContain('GET');
    expect(key).toContain('/users');
  });

  it('generates different keys for different methods', () => {
    const k1 = generateCacheKey('GET', '/users');
    const k2 = generateCacheKey('POST', '/users');
    expect(k1).not.toBe(k2);
  });

  it('generates different keys for different bodies', () => {
    const k1 = generateCacheKey('POST', '/users', { name: 'a' });
    const k2 = generateCacheKey('POST', '/users', { name: 'b' });
    expect(k1).not.toBe(k2);
  });

  it('generates the same key for the same inputs (deterministic)', () => {
    const k1 = generateCacheKey('GET', '/users', undefined);
    const k2 = generateCacheKey('GET', '/users', undefined);
    expect(k1).toBe(k2);
  });

  it('normalizes method to uppercase', () => {
    const k1 = generateCacheKey('get', '/users');
    const k2 = generateCacheKey('GET', '/users');
    expect(k1).toBe(k2);
  });
});

// ─── sleep ────────────────────────────────────────────────────────────────────

describe('sleep', () => {
  it('resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // allow some slack
  });

  it('rejects immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('aborted'));
    await expect(sleep(1000, controller.signal)).rejects.toThrow();
  });

  it('rejects when signal aborts during sleep', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(sleep(2000, controller.signal)).rejects.toBeDefined();
  });
});

// ─── createTimeoutSignal ──────────────────────────────────────────────────────

describe('createTimeoutSignal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a signal that is not aborted immediately', () => {
    const { signal, clear } = createTimeoutSignal(5000);
    expect(signal.aborted).toBe(false);
    clear();
  });

  it('aborts after the given delay', async () => {
    vi.useFakeTimers();
    const { signal } = createTimeoutSignal(100);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(101);
    expect(signal.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('does not abort when cleared before timeout', () => {
    vi.useFakeTimers();
    const { signal, clear } = createTimeoutSignal(100);
    clear();
    vi.advanceTimersByTime(200);
    expect(signal.aborted).toBe(false);
    vi.useRealTimers();
  });
});

// ─── combineSignals ───────────────────────────────────────────────────────────

describe('combineSignals', () => {
  it('stays non-aborted when no signals abort', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const { signal, cleanup } = combineSignals([c1.signal, c2.signal]);
    expect(signal.aborted).toBe(false);
    cleanup();
  });

  it('aborts when first signal aborts', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const { signal, cleanup } = combineSignals([c1.signal, c2.signal]);
    c1.abort();
    expect(signal.aborted).toBe(true);
    cleanup();
  });

  it('aborts when second signal aborts', () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const { signal, cleanup } = combineSignals([c1.signal, c2.signal]);
    c2.abort();
    expect(signal.aborted).toBe(true);
    cleanup();
  });

  it('returns an aborted signal if an input is already aborted', () => {
    const c1 = new AbortController();
    c1.abort();
    const { signal } = combineSignals([c1.signal]);
    expect(signal.aborted).toBe(true);
  });
});

// ─── parseResponseBody ────────────────────────────────────────────────────────

describe('parseResponseBody', () => {
  it('parses JSON content-type as JSON', async () => {
    const res = new Response('{"name":"Alice"}', {
      headers: { 'content-type': 'application/json' },
    });
    const data = await parseResponseBody(res);
    expect(data).toEqual({ name: 'Alice' });
  });

  it('parses text/plain as text', async () => {
    const res = new Response('Hello world', {
      headers: { 'content-type': 'text/plain' },
    });
    const data = await parseResponseBody(res);
    expect(data).toBe('Hello world');
  });

  it('parses text/html as text', async () => {
    const res = new Response('<h1>Hello</h1>', {
      headers: { 'content-type': 'text/html' },
    });
    const data = await parseResponseBody(res);
    expect(data).toBe('<h1>Hello</h1>');
  });

  it('falls back to text when JSON parsing fails', async () => {
    const res = new Response('not-json', {
      headers: { 'content-type': 'application/json' },
    });
    // The response will throw on .json() — should fall back to text
    const data = await parseResponseBody(res);
    expect(data).toBe('not-json');
  });

  it('returns ArrayBuffer for unknown content-type', async () => {
    const res = new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'application/octet-stream' },
    });
    const data = await parseResponseBody(res);
    expect(data).toBeInstanceOf(ArrayBuffer);
  });
});

// ─── Environment flags ────────────────────────────────────────────────────────

describe('environment flags', () => {
  it('isServer is true in Node.js test environment', () => {
    // Running in Node.js (no window) so isServer should be true
    expect(isServer).toBe(true);
  });

  it('isBrowser is false in Node.js test environment', () => {
    expect(isBrowser).toBe(false);
  });
});
