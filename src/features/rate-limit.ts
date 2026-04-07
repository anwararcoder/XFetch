/**
 * XFetch - Universal Fetch Client
 * Author: Anwar Ramadan
 * Company: AR-Coder Company
 */

// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Rate Limiter
//
// Implements a fixed-window rate limiter to protect backend APIs from
// accidental request floods (e.g. React render loops, runaway retries).
//
// Usage:
//   const limiter = new RateLimiter({ maxRequests: 60, windowMs: 60_000 });
//   api.interceptors.request.use(async (ctx) => {
//     limiter.check(); // throws XFetchError 429 if limit exceeded
//     return ctx;
//   });
// ─────────────────────────────────────────────────────────────────────────────

import { XFetchError } from '../utils/types.js';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface RateLimiterOptions {
  /**
   * Maximum number of requests allowed within the time window.
   * @default 60
   */
  maxRequests?: number;
  /**
   * Duration of the sliding window in milliseconds.
   * @default 60_000 (1 minute)
   */
  windowMs?: number;
  /**
   * Optional message to include in the thrown error.
   * @default 'Rate limit exceeded. Please slow down.'
   */
  message?: string;
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

/**
 * RateLimiter — Fixed-window request throttle.
 *
 * Tracks timestamps of recent calls and throws an XFetchError (status 429)
 * if the number of calls in the current window exceeds `maxRequests`.
 *
 * This is intentionally client-side only — it provides a safety net
 * against accidental flooding, not a replacement for server-side rate limiting.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({ maxRequests: 30, windowMs: 10_000 });
 *
 * api.interceptors.request.use((ctx) => {
 *   limiter.check();
 *   return ctx;
 * });
 * ```
 */
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly message: string;
  /** Timestamps (in ms) of recent requests, oldest first */
  private readonly timestamps: number[] = [];

  constructor(options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 60;
    this.windowMs    = options.windowMs    ?? 60_000;
    this.message     = options.message     ?? 'Rate limit exceeded. Please slow down.';

    if (this.maxRequests < 1) throw new RangeError('[XFetch] RateLimiter: maxRequests must be >= 1');
    if (this.windowMs   < 1) throw new RangeError('[XFetch] RateLimiter: windowMs must be >= 1');
  }

  /**
   * Records a new request and throws if the rate limit is breached.
   *
   * @throws {XFetchError} status 429 when limit is exceeded
   */
  check(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Evict timestamps outside the current window (sliding expiry)
    while (this.timestamps.length > 0 && this.timestamps[0]! < windowStart) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxRequests) {
      throw new XFetchError({
        message:        this.message,
        status:         429,
        statusText:     'Too Many Requests',
        isNetworkError: false,
      });
    }

    this.timestamps.push(now);
  }

  /** Resets the internal request counter. Useful for testing. */
  reset(): void {
    this.timestamps.length = 0;
  }

  /** Returns the number of requests recorded in the current window. */
  get count(): number {
    const windowStart = Date.now() - this.windowMs;
    return this.timestamps.filter((t) => t >= windowStart).length;
  }

  /** Returns the remaining request budget for the current window. */
  get remaining(): number {
    return Math.max(0, this.maxRequests - this.count);
  }
}
