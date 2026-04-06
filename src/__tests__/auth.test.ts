// ─────────────────────────────────────────────────────────────────────────────
// auth.test.ts — Unit tests for src/features/auth.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from '../../features/auth.js';
import { XFetchError } from '../../utils/types.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function make401(): XFetchError {
  return new XFetchError({ message: 'Unauthorized', status: 401 });
}

// ─── Token injection ──────────────────────────────────────────────────────────

describe('AuthManager — token injection', () => {
  it('injects Authorization header when token is set', () => {
    const mgr = new AuthManager({ token: 'abc123' });
    const headers: Record<string, string> = {};
    mgr.injectHeader(headers);
    expect(headers['authorization']).toBe('Bearer abc123');
  });

  it('does not inject header when no token', () => {
    const mgr = new AuthManager();
    const headers: Record<string, string> = {};
    mgr.injectHeader(headers);
    expect(headers['authorization']).toBeUndefined();
  });

  it('uses custom scheme', () => {
    const mgr = new AuthManager({ token: 'tok', scheme: 'Token' });
    const headers: Record<string, string> = {};
    mgr.injectHeader(headers);
    expect(headers['authorization']).toBe('Token tok');
  });

  it('uses custom header name (lowercased)', () => {
    const mgr = new AuthManager({ token: 'tok', headerName: 'X-API-Key' });
    const h: Record<string, string> = {};
    mgr.injectHeader(h);
    expect(h['x-api-key']).toBe('Bearer tok');
  });

  it('setToken updates the injected value', () => {
    const mgr = new AuthManager({ token: 'old' });
    mgr.setToken('new');
    const h: Record<string, string> = {};
    mgr.injectHeader(h);
    expect(h['authorization']).toBe('Bearer new');
  });

  it('clearToken prevents injection', () => {
    const mgr = new AuthManager({ token: 'tok' });
    mgr.clearToken();
    const h: Record<string, string> = {};
    mgr.injectHeader(h);
    expect(h['authorization']).toBeUndefined();
  });

  it('getToken returns current token', () => {
    const mgr = new AuthManager({ token: 'tok' });
    expect(mgr.getToken()).toBe('tok');
    mgr.clearToken();
    expect(mgr.getToken()).toBeNull();
  });
});

// ─── Refresh flow ─────────────────────────────────────────────────────────────

describe('AuthManager — 401 refresh flow', () => {
  it('re-throws 401 immediately if no refreshToken fn', async () => {
    const mgr = new AuthManager({ token: 'tok' });
    const err = make401();
    await expect(mgr.handleUnauthorized(err, async () => 'ok')).rejects.toBe(err);
  });

  it('calls refreshToken and retries on 401', async () => {
    const refreshFn = vi.fn().mockResolvedValue('new-token');
    const retry = vi.fn().mockResolvedValue('retried');
    const mgr = new AuthManager({ token: 'old', refreshToken: refreshFn });

    const result = await mgr.handleUnauthorized(make401(), retry);
    expect(refreshFn).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith('new-token');
    expect(result).toBe('retried');
    expect(mgr.getToken()).toBe('new-token');
  });

  it('clears token and re-throws 401 when refreshToken returns null', async () => {
    const refreshFn = vi.fn().mockResolvedValue(null);
    const mgr = new AuthManager({ token: 'old', refreshToken: refreshFn });
    const err = make401();

    await expect(mgr.handleUnauthorized(err, async () => 'ok')).rejects.toBe(err);
    expect(mgr.getToken()).toBeNull();
  });

  it('coalesces parallel 401s into a single refresh call', async () => {
    let resolveFn!: (token: string) => void;
    const refreshFn = vi.fn().mockReturnValue(
      new Promise<string>((res) => { resolveFn = res; })
    );
    const retry = vi.fn().mockResolvedValue('retried');
    const mgr = new AuthManager({ token: 'old', refreshToken: refreshFn });

    const p1 = mgr.handleUnauthorized(make401(), retry);
    const p2 = mgr.handleUnauthorized(make401(), retry);

    resolveFn('new-token');
    await Promise.all([p1, p2]);

    // refreshToken should only be called ONCE
    expect(refreshFn).toHaveBeenCalledOnce();
  });

  it('throws retry error when the post-refresh retry fails (BUG-7 context)', async () => {
    const retryError = new XFetchError({ message: '500 after refresh', status: 500 });
    const refreshFn = vi.fn().mockResolvedValue('new-token');
    const retry = vi.fn().mockRejectedValue(retryError);
    const mgr = new AuthManager({ token: 'old', refreshToken: refreshFn });

    // The retry threw a 500, not the original 401 — that should be surfaced
    await expect(mgr.handleUnauthorized(make401(), retry)).rejects.toBe(retryError);
  });

  it('re-throws refresh error when refreshToken throws', async () => {
    const refreshErr = new Error('refresh network error');
    const refreshFn = vi.fn().mockRejectedValue(refreshErr);
    const mgr = new AuthManager({ token: 'old', refreshToken: refreshFn });

    await expect(mgr.handleUnauthorized(make401(), async () => 'ok')).rejects.toBe(refreshErr);
  });
});

// ─── AuthManager.from factory ─────────────────────────────────────────────────

describe('AuthManager.from', () => {
  it('creates with no options', () => {
    const mgr = AuthManager.from();
    expect(mgr.getToken()).toBeNull();
  });

  it('creates with options', () => {
    const mgr = AuthManager.from({ token: 'abc' });
    expect(mgr.getToken()).toBe('abc');
  });
});
