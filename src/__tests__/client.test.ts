// ─────────────────────────────────────────────────────────────────────────────
// client.test.ts — Integration tests for src/core/client.ts (createClient)
//
// Tests the complete request pipeline: interceptors → cache → retry → auth
// NOTE: All tests use baseURL: 'https://api.test' because Node's Request
// constructor requires absolute URLs.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '../../core/client.js';
import { XFetchError } from '../../utils/types.js';
import type { XFetchPlugin, RequestContext } from '../../utils/types.js';

const BASE = 'https://api.test';

// ─── Mock fetch helper ────────────────────────────────────────────────────────

function mockFetchOnce(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(bodyStr, { status, headers: { 'content-type': 'application/json', ...headers } })
    )
  );
}

function mockFetchSequence(responses: Array<{ body: unknown; status: number }>) {
  let i = 0;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
    const r = responses[i++] ?? responses[responses.length - 1];
    const bodyStr = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return Promise.resolve(
      new Response(bodyStr, { status: r.status, headers: { 'content-type': 'application/json' } })
    );
  }));
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

// ─── Convenience factory ──────────────────────────────────────────────────────
const client = (extra = {}) => createClient({ baseURL: BASE, debug: false, retry: { count: 0 }, ...extra });

// ─── Basic HTTP methods ───────────────────────────────────────────────────────

describe('createClient — HTTP methods', () => {
  it('GET returns typed data', async () => {
    mockFetchOnce({ id: 1, name: 'Alice' });
    const { data } = await client().get<{ id: number; name: string }>('/users/1');
    expect(data).toEqual({ id: 1, name: 'Alice' });
  });

  it('POST sends body as JSON', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{"id":2}', { status: 201, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    await client().post<{ id: number }>('/users', { name: 'Bob' });

    const req: Request = mockFn.mock.calls[0][0];
    expect(req.method).toBe('POST');
    expect(req.headers.get('content-type')).toBe('application/json');
    const body = await req.text();
    expect(JSON.parse(body)).toEqual({ name: 'Bob' });
  });

  it('DELETE sends correct method', async () => {
    const mockFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mockFn);
    await client().delete('/item/1');
    expect((mockFn.mock.calls[0][0] as Request).method).toBe('DELETE');
  });

  it('PUT sends correct method', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    await client().put('/item/1', { name: 'Updated' });
    expect((mockFn.mock.calls[0][0] as Request).method).toBe('PUT');
  });

  it('generic request() works', async () => {
    mockFetchOnce({ ok: true });
    const res = await client().request('PATCH', '/item/1');
    expect(res.status).toBe(200);
  });
});

// ─── Default headers & baseURL ────────────────────────────────────────────────

describe('createClient — config', () => {
  it('prepends baseURL to all requests', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    const api = createClient({ baseURL: 'https://api.example.com', debug: false });
    await api.get('/users');
    expect((mockFn.mock.calls[0][0] as Request).url).toBe('https://api.example.com/users');
  });

  it('sends global default headers on every request', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    const api = createClient({ baseURL: BASE, headers: { 'x-app': 'v1' }, debug: false });
    await api.get('/test');
    expect((mockFn.mock.calls[0][0] as Request).headers.get('x-app')).toBe('v1');
  });
});

// ─── Interceptors ─────────────────────────────────────────────────────────────

describe('createClient — interceptors', () => {
  it('request interceptor can modify headers', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);

    const api = client();
    api.interceptors.request.use((ctx: RequestContext) => {
      ctx.headers['x-intercepted'] = 'yes';
      return ctx;
    });

    await api.get('/test');
    expect((mockFn.mock.calls[0][0] as Request).headers.get('x-intercepted')).toBe('yes');
  });

  it('response interceptor can transform data', async () => {
    mockFetchOnce({ raw: 'value' });
    const api = client();
    api.interceptors.response.use((res) => {
      (res.data as Record<string, unknown>)['added'] = true;
      return res;
    });

    const { data } = await api.get<{ raw: string; added: boolean }>('/test');
    expect(data.added).toBe(true);
  });

  it('error interceptor is called on failure', async () => {
    mockFetchOnce('Not Found', 404);
    const api = client();
    const errHandler = vi.fn((e: XFetchError) => e);
    api.interceptors.error.use(errHandler);

    await expect(api.get('/missing')).rejects.toBeInstanceOf(XFetchError);
    expect(errHandler).toHaveBeenCalledOnce();
  });

  it('interceptor eject stops the interceptor from running', async () => {
    mockFetchOnce({ data: true });
    const api = client();
    const spy = vi.fn((ctx: RequestContext) => ctx);
    const handle = api.interceptors.request.use(spy);
    api.interceptors.request.eject(handle.id);

    await api.get('/test');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── Retry ────────────────────────────────────────────────────────────────────

describe('createClient — retry', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('retries on 503 and succeeds', async () => {
    mockFetchSequence([
      { body: 'error', status: 503 },
      { body: { ok: true }, status: 200 },
    ]);
    const api = createClient({ baseURL: BASE, debug: false, retry: { count: 1, delay: 10 } });
    const promise = api.get('/endpoint');
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
  });

  it('retry: false disables retry', async () => {
    const mockFn = vi.fn().mockResolvedValue(new Response('error', { status: 503 }));
    vi.stubGlobal('fetch', mockFn);
    const api = createClient({ baseURL: BASE, debug: false, retry: { count: 3 } });
    const [result] = await Promise.all([
      api.get('/endpoint', { retry: false }).catch((e) => e as XFetchError),
      vi.runAllTimersAsync(),
    ]);
    expect(result).toMatchObject({ status: 503 });
    expect(mockFn).toHaveBeenCalledOnce();
  });
});

// ─── Caching (BUG-9 regression test) ─────────────────────────────────────────

describe('createClient — caching (BUG-9 fix)', () => {
  it('cache hit returns fromCache: true and skips fetch', async () => {
    mockFetchOnce({ users: [] });
    const api = client();
    const opts = { cache: { storage: 'memory' as const, ttl: 60_000 } };
    await api.get('/users', opts); // miss
    const second = await api.get('/users', opts); // hit
    expect(second.fromCache).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it('cache: false bypasses cache per-request', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{"data":1}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    const api = createClient({
      baseURL: BASE,
      debug: false,
      retry: { count: 0 },
      cache: { storage: 'memory', ttl: 60_000 },
    });
    await api.get('/data', { cache: false });
    await api.get('/data', { cache: false });
    expect(mockFn).toHaveBeenCalledTimes(2);
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('createClient — auth', () => {
  it('injects Authorization header', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    const api = createClient({ baseURL: BASE, auth: { token: 'mytoken' }, debug: false });
    await api.get('/secure');
    expect((mockFn.mock.calls[0][0] as Request).headers.get('authorization')).toBe('Bearer mytoken');
  });

  it('setAuth updates the token', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    const api = client();
    api.setAuth('new-token');
    await api.get('/secure');
    expect((mockFn.mock.calls[0][0] as Request).headers.get('authorization')).toBe('Bearer new-token');
  });

  it('clearAuth removes the token', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    const api = createClient({ baseURL: BASE, auth: { token: 'tok' }, debug: false });
    api.clearAuth();
    await api.get('/open');
    expect((mockFn.mock.calls[0][0] as Request).headers.get('authorization')).toBeNull();
  });

  it('auth: false disables token injection per-request', async () => {
    const mockFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', mockFn);
    const api = createClient({ baseURL: BASE, auth: { token: 'tok' }, debug: false });
    await api.get('/public', { auth: false });
    expect((mockFn.mock.calls[0][0] as Request).headers.get('authorization')).toBeNull();
  });
});

// ─── Plugin system ────────────────────────────────────────────────────────────

describe('createClient — plugin system', () => {
  it('installs a plugin and calls install()', () => {
    const install = vi.fn();
    const plugin: XFetchPlugin = { name: 'test-plugin', install };
    const api = client();
    api.use(plugin);
    expect(install).toHaveBeenCalledWith(api);
  });

  it('does not install the same plugin twice (double-install guard)', () => {
    const install = vi.fn();
    const plugin: XFetchPlugin = { name: 'my-plugin', install };
    const api = client();
    api.use(plugin);
    api.use(plugin);
    expect(install).toHaveBeenCalledOnce();
  });

  it('returns the client for chaining', () => {
    const plugin: XFetchPlugin = { name: 'chain-plugin', install: vi.fn() };
    const api = client();
    const result = api.use(plugin);
    // use() returns the same client instance for chaining
    expect(result).toBe(api);
  });
});

// ─── Error class ──────────────────────────────────────────────────────────────

describe('XFetchError', () => {
  it('is an instanceof Error', () => {
    const err = new XFetchError({ message: 'test' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(XFetchError);
  });

  it('has name XFetchError', () => {
    expect(new XFetchError({ message: 'x' }).name).toBe('XFetchError');
  });

  it('toJSON returns a serializable object', () => {
    const err = new XFetchError({ message: 'fail', status: 500, data: { error: 'oops' } });
    const json = err.toJSON();
    expect(json.message).toBe('fail');
    expect(json.status).toBe(500);
    expect(json.data).toEqual({ error: 'oops' });
    expect(JSON.stringify(json)).toBeTruthy();
  });

  it('defaults isNetworkError/isTimeout/isAborted to false', () => {
    const err = new XFetchError({ message: 'err' });
    expect(err.isNetworkError).toBe(false);
    expect(err.isTimeout).toBe(false);
    expect(err.isAborted).toBe(false);
  });
});

// ─── Cancellation ────────────────────────────────────────────────────────────

describe('createClient — cancellation', () => {
  it('throws XFetchError with isAborted:true when request is cancelled', async () => {
    const controller = new AbortController();

    // The combined signal is already aborted, so fetch() will reject immediately
    // with an AbortError (Node.js 18+ throws DOMException or plain AbortError).
    // We mock fetch to respect the signal.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_req: Request, init: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }));

    // Pre-abort the signal before making the request
    controller.abort();
    const api = client();
    const result = await api.get('/slow', { signal: controller.signal }).catch((e) => e as XFetchError);
    expect(result).toMatchObject({ isAborted: true });
  });
});
