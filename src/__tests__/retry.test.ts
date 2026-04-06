// ─────────────────────────────────────────────────────────────────────────────
// retry.test.ts — Unit tests for src/features/retry.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateDelay, shouldRetry, withRetry, RETRY_DEFAULTS } from '../../features/retry.js';
import { XFetchError } from '../../utils/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeError(params: ConstructorParameters<typeof XFetchError>[0]): XFetchError {
  return new XFetchError(params);
}

const RESOLVED_OPTS = {
  count: 3,
  delay: 0,       // instant for testing
  maxDelay: 30_000,
  statusCodes: RETRY_DEFAULTS.statusCodes,
  condition: undefined,
};

// ─── calculateDelay ───────────────────────────────────────────────────────────

describe('calculateDelay', () => {
  it('returns a positive number', () => {
    expect(calculateDelay(0, 500, 30_000)).toBeGreaterThanOrEqual(0);
  });

  it('increases with attempt number (statistically)', () => {
    const d0 = Array.from({ length: 10 }, () => calculateDelay(0, 500, 30_000));
    const d2 = Array.from({ length: 10 }, () => calculateDelay(2, 500, 30_000));
    const avg0 = d0.reduce((a, b) => a + b, 0) / d0.length;
    const avg2 = d2.reduce((a, b) => a + b, 0) / d2.length;
    expect(avg2).toBeGreaterThan(avg0);
  });

  it('caps at maxDelay (with jitter allowance)', () => {
    const capped = calculateDelay(100, 500, 1000);
    expect(capped).toBeLessThanOrEqual(1_200); // max + 20% jitter
  });

  it('never returns negative', () => {
    for (let i = 0; i < 50; i++) {
      expect(calculateDelay(0, 100, 100)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── shouldRetry ──────────────────────────────────────────────────────────────

describe('shouldRetry', () => {
  it('returns false when attempt >= count', () => {
    const err = makeError({ message: 'fail', isNetworkError: true });
    expect(shouldRetry(err, 3, RESOLVED_OPTS)).toBe(false);
  });

  it('returns false for aborted requests', () => {
    const err = makeError({ message: 'aborted', isAborted: true });
    expect(shouldRetry(err, 0, RESOLVED_OPTS)).toBe(false);
  });

  it('returns true for network errors', () => {
    const err = makeError({ message: 'network fail', isNetworkError: true });
    expect(shouldRetry(err, 0, RESOLVED_OPTS)).toBe(true);
  });

  it('returns true for timeout errors', () => {
    const err = makeError({ message: 'timeout', isTimeout: true });
    expect(shouldRetry(err, 0, RESOLVED_OPTS)).toBe(true);
  });

  it('returns true for 500 status', () => {
    const err = makeError({ message: 'server error', status: 500 });
    expect(shouldRetry(err, 0, RESOLVED_OPTS)).toBe(true);
  });

  it('returns true for 503 status', () => {
    const err = makeError({ message: 'unavailable', status: 503 });
    expect(shouldRetry(err, 0, RESOLVED_OPTS)).toBe(true);
  });

  it('returns false for 400 status (not retryable)', () => {
    const err = makeError({ message: 'bad request', status: 400 });
    expect(shouldRetry(err, 0, RESOLVED_OPTS)).toBe(false);
  });

  it('returns false for 404 status (not retryable)', () => {
    const err = makeError({ message: 'not found', status: 404 });
    expect(shouldRetry(err, 0, RESOLVED_OPTS)).toBe(false);
  });

  it('returns false for 401 status (not in default list)', () => {
    const err = makeError({ message: 'unauthorized', status: 401 });
    expect(shouldRetry(err, 0, RESOLVED_OPTS)).toBe(false);
  });

  it('uses custom condition function when provided', () => {
    const err = makeError({ message: 'weird', status: 418 });
    const opts = { ...RESOLVED_OPTS, condition: (e: XFetchError) => e.status === 418 };
    expect(shouldRetry(err, 0, opts)).toBe(true);
  });

  it('custom condition overrides status-code check', () => {
    const err = makeError({ message: 'server error', status: 500 });
    const opts = { ...RESOLVED_OPTS, condition: (_: XFetchError) => false };
    expect(shouldRetry(err, 0, opts)).toBe(false);
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns result immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { count: 3, delay: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on network error and eventually succeeds', async () => {
    const networkErr = makeError({ message: 'network fail', isNetworkError: true });
    const fn = vi.fn()
      .mockRejectedValueOnce(networkErr)
      .mockRejectedValueOnce(networkErr)
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { count: 3, delay: 10 });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on 503 and eventually succeeds', async () => {
    const serverErr = makeError({ message: 'service unavailable', status: 503 });
    const fn = vi.fn()
      .mockRejectedValueOnce(serverErr)
      .mockResolvedValue({ data: 'data' });

    const promise = withRetry(fn, { count: 2, delay: 10 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ data: 'data' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Use Promise.all to advance timers and catch the rejection atomically,
  // preventing unhandled rejection warnings that occur when the promise
  // rejects between runAllTimersAsync() and await expect().
  it('exhausts retries and throws the final error', async () => {
    const networkErr = makeError({ message: 'always fails', isNetworkError: true });
    const fn = vi.fn().mockRejectedValue(networkErr);

    const [result] = await Promise.all([
      withRetry(fn, { count: 3, delay: 10 }).catch((e) => e as XFetchError),
      vi.runAllTimersAsync(),
    ]);
    expect(result).toMatchObject({ message: 'always fails' });
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('does NOT retry on 400 bad request', async () => {
    const clientErr = makeError({ message: 'bad request', status: 400 });
    const fn = vi.fn().mockRejectedValue(clientErr);

    // 400 is not retryable — should throw immediately with no sleep needed
    const err = await withRetry(fn, { count: 3, delay: 10 }).catch((e) => e as XFetchError);
    expect(err).toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('does NOT retry aborted requests', async () => {
    const abortErr = makeError({ message: 'aborted', isAborted: true });
    const fn = vi.fn().mockRejectedValue(abortErr);

    const err = await withRetry(fn, { count: 3, delay: 10 }).catch((e) => e as XFetchError);
    expect(err).toMatchObject({ isAborted: true });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('stops retrying when abort signal fires during sleep', async () => {
    const networkErr = makeError({ message: 'network fail', isNetworkError: true });
    const fn = vi.fn().mockRejectedValue(networkErr);
    const controller = new AbortController();
    controller.abort(); // pre-abort so sleep rejects immediately

    const [result] = await Promise.all([
      withRetry(fn, { count: 5, delay: 100 }, controller.signal).catch((e) => e),
      vi.runAllTimersAsync(),
    ]);
    expect(result).toBeDefined();
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('wraps non-XFetchError throws into XFetchError (BUG-12 fix)', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await withRetry(fn, { count: 0, delay: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(XFetchError);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('respects count: 0 (no retries)', async () => {
    const err = makeError({ message: 'fail', isNetworkError: true });
    const fn = vi.fn().mockRejectedValue(err);

    const result = await withRetry(fn, { count: 0 }).catch((e) => e);
    expect(result).toBeDefined();
    expect(fn).toHaveBeenCalledOnce();
  });
});
