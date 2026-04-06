// ─────────────────────────────────────────────────────────────────────────────
// XFetch — InterceptorManager
//
// Manages ordered chains of request, response, and error interceptors.
// Follows the same pattern as Axios interceptors (use / eject / forEach).
// ─────────────────────────────────────────────────────────────────────────────

import type { InterceptorRecord, InterceptorHandle, XFetchError } from '../utils/types.js';

// Re-export for convenience
export type { InterceptorRecord, InterceptorHandle };

/**
 * InterceptorManager<T>
 *
 * A generic linked list of interceptors that transform a value of type T.
 * Each interceptor has:
 *  - `fulfilled(value: T) → T | Promise<T>` — the happy-path transformer
 *  - `rejected?(error: XFetchError) → T | Promise<T>` — optional error recovery
 */
export class InterceptorManager<T> {
  /** Internal storage — null slots mark ejected interceptors */
  private readonly handlers: (InterceptorRecord<T> | null)[] = [];
  private counter = 0;

  /**
   * Adds a new interceptor to the chain.
   * Returns a handle with an `id` that can be passed to `eject()`.
   *
   * @param fulfilled  Called with the current value; must return a (possibly modified) value
   * @param rejected   Optional — called when a previous step throws; can recover or re-throw
   */
  use(
    fulfilled: (value: T) => T | Promise<T>,
    rejected?: (error: XFetchError) => T | Promise<T>
  ): InterceptorHandle {
    const id = this.counter++;
    this.handlers.push({ id, fulfilled, rejected });
    return { id };
  }

  /**
   * Removes an interceptor by the id returned from `use()`.
   * The slot is nulled out — the array is never re-indexed
   * so that other ids remain stable.
   */
  eject(id: number): void {
    const index = this.handlers.findIndex((h) => h?.id === id);
    if (index !== -1) {
      this.handlers[index] = null;
    }
  }

  /**
   * Iterates over all active (non-ejected) interceptors in insertion order.
   * Used internally by the request pipeline.
   */
  forEach(callback: (handler: InterceptorRecord<T>) => void): void {
    for (const handler of this.handlers) {
      if (handler !== null) {
        callback(handler);
      }
    }
  }

  /**
   * Reduces a value through the full interceptor chain.
   * If an interceptor's `fulfilled` throws and the next interceptor has a
   * `rejected` handler, the error is passed there for recovery.
   *
   * Mirrors how Axios builds its internal promise chain.
   */
  async run(initialValue: T): Promise<T> {
    const chain: Array<InterceptorRecord<T>> = [];
    this.forEach((h) => chain.push(h));

    let value = initialValue;

    for (const interceptor of chain) {
      try {
        value = await interceptor.fulfilled(value);
      } catch (err) {
        if (interceptor.rejected) {
          value = await interceptor.rejected(err as XFetchError);
        } else {
          // Re-throw — no recovery handler registered
          throw err;
        }
      }
    }

    return value;
  }

  /** Returns the count of active interceptors (for diagnostics / testing) */
  get size(): number {
    return this.handlers.filter(Boolean).length;
  }

  /** Removes all interceptors */
  clear(): void {
    this.handlers.length = 0;
    this.counter = 0;
  }
}
