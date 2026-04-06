/**
 * XFetch - Universal Fetch Client
 * Author: Anwar Ramadan
 * Company: AR-Coder Company
 */

// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Public Entry Point
//
// Everything exported from here is part of the public API surface.
// Tree-shaking friendly: framework adapters are in separate entry points
// (xfetch/react, xfetch/vue) so they don't pollute the core bundle.
// ─────────────────────────────────────────────────────────────────────────────

// ── Core API ────────────────────────────────────────────────────────────────
export { createClient } from './core/client.js';

// ── Types & Error class ─────────────────────────────────────────────────────
export {
  XFetchError,
  type HttpMethod,
  type XFetchConfig,
  type XFetchResponse,
  type RequestOptions,
  type CacheOptions,
  type RetryOptions,
  type AuthOptions,
  type XFetchClient,
  type XFetchPlugin,
  type InterceptorHandle,
  type RequestContext,
} from './utils/types.js';

// ── Cache system ─────────────────────────────────────────────────────────────
export { CacheManager, MemoryCache, LocalStorageCache } from './features/cache.js';

// ── Retry utilities ──────────────────────────────────────────────────────────
export { withRetry, shouldRetry, calculateDelay, RETRY_DEFAULTS } from './features/retry.js';

// ── Auth manager ─────────────────────────────────────────────────────────────
export { AuthManager } from './features/auth.js';

// ── Plugins ──────────────────────────────────────────────────────────────────
export { loggerPlugin, createLoggerPlugin } from './plugins/logger.js';

// ── Utility helpers ──────────────────────────────────────────────────────────
export {
  buildURL,
  appendParams,
  mergeHeaders,
  generateCacheKey,
  isServer,
  isBrowser,
  isDev,
} from './utils/helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Default export — a convenience pre-configured client using defaults.
// Useful for quick scripts: import api from 'xfetch'; api.get('/endpoint');
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from './core/client.js';

export default createClient();
