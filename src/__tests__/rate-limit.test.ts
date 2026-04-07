import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../features/rate-limit.js';
import { XFetchError } from '../utils/types.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default options', () => {
    const limiter = new RateLimiter();
    expect(limiter.remaining).toBe(60);
    expect(limiter.count).toBe(0);
  });

  it('throws RangeError for invalid options', () => {
    expect(() => new RateLimiter({ maxRequests: 0 })).toThrow(RangeError);
    expect(() => new RateLimiter({ maxRequests: -5 })).toThrow(RangeError);
    expect(() => new RateLimiter({ windowMs: 0 })).toThrow(RangeError);
    expect(() => new RateLimiter({ windowMs: -100 })).toThrow(RangeError);
  });

  it('allows requests up to maxRequests', () => {
    const limiter = new RateLimiter({ maxRequests: 3 });
    
    // 1st request
    expect(() => limiter.check()).not.toThrow();
    expect(limiter.count).toBe(1);
    expect(limiter.remaining).toBe(2);

    // 2nd request
    expect(() => limiter.check()).not.toThrow();
    expect(limiter.count).toBe(2);
    expect(limiter.remaining).toBe(1);

    // 3rd request
    expect(() => limiter.check()).not.toThrow();
    expect(limiter.count).toBe(3);
    expect(limiter.remaining).toBe(0);
  });

  it('throws a 429 XFetchError when rate limit is exceeded', () => {
    const message = 'Custom rate limit message';
    const limiter = new RateLimiter({ maxRequests: 2, message });

    limiter.check();
    limiter.check();

    // 3rd request should fail
    let capturedError: unknown;
    try {
      limiter.check();
    } catch (e) {
      capturedError = e;
    }

    expect(capturedError).toBeInstanceOf(XFetchError);
    const err = capturedError as XFetchError;
    expect(err.status).toBe(429);
    expect(err.message).toBe(message);
    expect(err.statusText).toBe('Too Many Requests');
    expect(err.isNetworkError).toBe(false);
  });

  it('evicts old timestamps correctly (sliding window)', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

    limiter.check(); // now = 0
    expect(limiter.count).toBe(1);

    vi.advanceTimersByTime(500);
    limiter.check(); // now = 500
    expect(limiter.count).toBe(2);
    expect(limiter.remaining).toBe(0);

    // Try a 3rd request right now -> should fail
    expect(() => limiter.check()).toThrow(XFetchError);

    // Advance time so the first request (at 0) expires, but the second (at 500) survives
    vi.advanceTimersByTime(501); // now = 1001
    
    // First request is older than windowMs (1000), so it should be evicted
    // Expect 1 remaining capacity
    expect(limiter.count).toBe(1);
    expect(limiter.remaining).toBe(1);

    // Should succeed now
    expect(() => limiter.check()).not.toThrow();
    expect(limiter.count).toBe(2);
    expect(limiter.remaining).toBe(0);

    // Try again -> should fail
    expect(() => limiter.check()).toThrow(XFetchError);

    // Advance enough past BOTH previous timestamps
    vi.advanceTimersByTime(2000);
    expect(limiter.count).toBe(0);
    expect(limiter.remaining).toBe(2);
  });

  it('resets the limiter state', () => {
    const limiter = new RateLimiter({ maxRequests: 5 });
    
    limiter.check();
    limiter.check();
    expect(limiter.count).toBe(2);

    limiter.reset();
    expect(limiter.count).toBe(0);
    expect(limiter.remaining).toBe(5);
  });
});
