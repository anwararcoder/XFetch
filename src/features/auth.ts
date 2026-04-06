// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Auth Manager
//
// Handles:
//   • Token injection (Authorization: Bearer <token>)
//   • Token refresh on 401 (calls user-supplied refreshToken hook)
//   • Single retry of original request after a successful refresh
//   • Configurable header name and token scheme
// ─────────────────────────────────────────────────────────────────────────────

import type { AuthOptions, XFetchError } from '../utils/types.js';

// ─── Auth Manager class ───────────────────────────────────────────────────────

/**
 * AuthManager
 *
 * Stores the current auth token and exposes two integration points:
 *
 * 1. `injectHeader(headers)` — called before every request to add the token header
 * 2. `handleUnauthorized(error, retry)` — called on 401; may refresh + retry
 *
 * Lifecycle:
 *   createClient() → AuthManager.from(config.auth)
 *   client.setAuth(token) → updates the stored token
 *   client.clearAuth()    → removes the stored token
 */
export class AuthManager {
  private token: string | null;
  /** The header name used for auth injection (default: 'authorization') */
  public readonly headerName: string;
  private readonly scheme: string;
  private readonly refreshFn: (() => Promise<string | null>) | undefined;

  /** Whether a token refresh is currently in progress (prevents parallel refreshes) */
  private refreshing: Promise<string | null> | null = null;

  constructor(options: AuthOptions = {}) {
    this.token      = options.token ?? null;
    this.headerName = (options.headerName ?? 'authorization').toLowerCase();
    this.scheme     = options.scheme ?? 'Bearer';
    this.refreshFn  = options.refreshToken;
  }

  /** Sets the active token. Called via `client.setAuth(token)`. */
  setToken(token: string): void {
    this.token = token;
  }

  /** Removes the active token. Called via `client.clearAuth()`. */
  clearToken(): void {
    this.token = null;
  }

  /** Returns the current token (for testing / diagnostics) */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Injects the Authorization header into the provided headers object.
   * Mutates the object in-place and returns it for convenience.
   * No-op if no token is stored.
   */
  injectHeader(headers: Record<string, string>): Record<string, string> {
    if (this.token) {
      headers[this.headerName] = `${this.scheme} ${this.token}`;
    }
    return headers;
  }

  /**
   * Called when a 401 Unauthorized response is received.
   *
   * Flow:
   *  1. If no `refreshToken` hook → re-throw the error
   *  2. If a refresh is already in-flight → wait for it (prevents parallel refreshes)
   *  3. Call `refreshToken()` → if null returned → re-throw
   *  4. Update stored token → call `retry()` with new token
   *
   * @param error  The XFetchError that triggered the 401
   * @param retry  Function to re-execute the original request
   * @returns      The result of the retried request
   */
  async handleUnauthorized<T>(
    error: XFetchError,
    retry: (newToken: string) => Promise<T>
  ): Promise<T> {
    if (!this.refreshFn) throw error;

    try {
      // Coalesce concurrent 401 errors into a single refresh attempt
      if (!this.refreshing) {
        this.refreshing = this.refreshFn();
      }

      const newToken = await this.refreshing;
      this.refreshing = null;

      if (!newToken) {
        this.token = null;
        throw error;
      }

      this.token = newToken;
      return await retry(newToken);
    } catch (refreshErr) {
      this.refreshing = null;
      // If the retry itself failed, surface the original 401 error
      throw refreshErr === error ? error : refreshErr;
    }
  }

  /**
   * Factory — creates an AuthManager from AuthOptions.
   * Returns a no-op manager if options are absent.
   */
  static from(options?: AuthOptions): AuthManager {
    return new AuthManager(options ?? {});
  }
}
