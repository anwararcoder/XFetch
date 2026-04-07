/**
 * XFetch - Universal Fetch Client
 * Author: Anwar Ramadan
 * Company: AR-Coder Company
 */

// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Retry Logic
//
// Implements smart retry with:
//   • Exponential backoff: delay = min(baseDelay * 2^attempt, maxDelay)
//   • Jitter: ±20% random variance to prevent thundering herd
//   • Configurable: retry count, delay, max delay, retryable status codes
//   • Custom condition function for full control
// ─────────────────────────────────────────────────────────────────────────────

import { XFetchError, type RetryOptions } from '../utils/types.js';
import { sleep } from '../utils/helpers.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const RETRY_DEFAULTS: Required<Omit<RetryOptions, 'condition' | 'allowedMethods'>> = {
  count: 3,
  delay: 500,
  maxDelay: 30_000,
  // These status codes represent transient server/client issues safe to retry
  statusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * Absolute hard ceiling on retry attempts regardless of what the consumer passes.
 * Prevents misconfiguration from creating infinite retry cycles that hammer backends.
 */
const MAX_RETRY_HARD_CAP = 10;

/**
 * HTTP methods that are idempotent by nature and safe to retry.
 * Retrying non-idempotent methods (POST, PATCH) can cause duplicate
 * side-effects such as double charges or duplicate writes.
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calculates delay for attempt N using exponential backoff + jitter.
 *
 * Formula: min(baseDelay * 2^attempt, maxDelay) ± 20% jitter
 *
 * @example
 * calculateDelay(0, 500, 30_000) // ~500ms
 * calculateDelay(1, 500, 30_000) // ~1000ms
 * calculateDelay(2, 500, 30_000) // ~2000ms
 */
export function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  const exponential = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add ±20% jitter to spread concurrent retries
  const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

/**
 * Determines whether a failed request should be retried on attempt N.
 *
 * Returns false if:
 *  - We've exhausted all retries
 *  - The error was an intentional abort (user-initiated)
 *  - The status code is not in the retryable set (e.g. 400 Bad Request = don't retry)
 *
 * Returns true if:
 *  - Error is a network error (fetch itself failed) or a timeout
 *  - Status code is in the retryable list
 *  - Or: a custom `condition` function returns true
 */
export function shouldRetry(
  error: XFetchError,
  attempt: number,
  options: Required<Omit<RetryOptions, 'condition' | 'allowedMethods'>> & Pick<RetryOptions, 'condition' | 'allowedMethods'>,
  method?: string
): boolean {
  // Hard cap: never exceed absolute maximum regardless of config
  if (attempt >= MAX_RETRY_HARD_CAP) return false;

  // Exhausted all configured attempts
  if (attempt >= options.count) return false;

  // Never retry user-aborted requests
  if (error.isAborted) return false;

  // Security: check method idempotency before allowing retry
  if (method) {
    const upperMethod = method.toUpperCase();
    const allowedMethods = options.allowedMethods ?? [...IDEMPOTENT_METHODS];
    const methodAllowed = allowedMethods
      .map((m: string) => m.toUpperCase())
      .includes(upperMethod);
    if (!methodAllowed) return false;
  }

  // Delegate to custom condition if provided
  if (options.condition) {
    return options.condition(error);
  }

  // Network errors and timeouts are always retried (transient failures)
  if (error.isNetworkError || error.isTimeout) return true;

  // Retry on specific HTTP status codes
  if (error.status !== undefined) {
    return options.statusCodes.includes(error.status);
  }

  return false;
}

// ─── Retry Runner ─────────────────────────────────────────────────────────────

/**
 * Executes `fn` with automatic retry on failure.
 *
 * @param fn       The async function to call (typically a fetch execution)
 * @param options  Merged retry options
 * @param signal   Optional AbortSignal — retries stop immediately if aborted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  signal?: AbortSignal,
  method?: string
): Promise<T> {
  const resolved = {
    count:         Math.min(options.count ?? RETRY_DEFAULTS.count, MAX_RETRY_HARD_CAP),
    delay:         options.delay      ?? RETRY_DEFAULTS.delay,
    maxDelay:      options.maxDelay   ?? RETRY_DEFAULTS.maxDelay,
    statusCodes:   options.statusCodes ?? RETRY_DEFAULTS.statusCodes,
    condition:     options.condition,
    allowedMethods: options.allowedMethods,
  };

  let attempt = 0;

  // BUG-1 FIX: removed `lastError` variable that was used-before-assignment.
  // We now throw `xErr` directly on exhaustion. Also BUG-12 FIX: wrap
  // non-XFetchError errors into XFetchError so shouldRetry receives a proper type.
  while (true) {
    try {
      return await fn();
    } catch (err) {
      // Normalize any thrown value into an XFetchError so shouldRetry logic is reliable
      const xErr =
        err instanceof XFetchError
          ? err
          : new XFetchError({
              message: err instanceof Error ? err.message : String(err),
              isNetworkError: !(err instanceof XFetchError),
            });

      if (!shouldRetry(xErr, attempt, resolved, method)) {
        throw xErr; // BUG-1 FIX: throw directly, no intermediate variable needed
      }

      const delay = calculateDelay(attempt, resolved.delay, resolved.maxDelay);

      // Wait before next attempt (respects abort signal)
      await sleep(delay, signal);

      attempt++;
    }
  }
}
