/**
 * XFetch - Universal Fetch Client
 * Author: Anwar Ramadan
 * Company: AR-Coder Company
 */

// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Client Factory
//
// `createClient(config)` is the primary public API.
// It returns a fully configured XFetchClient instance that wires together:
//   • InterceptorManager (request / response / error chains)
//   • CacheManager       (memory + localStorage + deduplication)
//   • AuthManager        (token injection + 401 refresh)
//   • Retry logic        (exponential backoff)
//   • Plugin system      (install() hook)
//   • Dev logger         (auto-enabled in development)
// ─────────────────────────────────────────────────────────────────────────────

import {
  XFetchError,
  type HttpMethod,
  type RequestOptions,
  type RetryOptions,
  type XFetchResponse,
  type XFetchConfig,
  type XFetchClient,
  type XFetchPlugin,
  type RequestContext,
} from '../utils/types.js';

import { mergeHeaders, generateCacheKey, isDev, scrubURL } from '../utils/helpers.js';
import { InterceptorManager } from './interceptors.js';
import { executeRequest, type ResolvedRequest } from './request.js';
import { CacheManager } from '../features/cache.js';
import { withRetry } from '../features/retry.js';
import { AuthManager } from '../features/auth.js';

// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000; // 30 seconds

/**
 * Creates a new XFetch client instance with the provided configuration.
 *
 * @example
 * ```ts
 * const api = createClient({
 *   baseURL: 'https://api.example.com',
 *   timeout: 10_000,
 *   retry: { count: 3 },
 * });
 *
 * const { data } = await api.get<User[]>('/users');
 * ```
 */
export function createClient(config: XFetchConfig = {}): XFetchClient {
  // ── Resolved config ───────────────────────────────────────
  const baseURL       = config.baseURL ?? '';
  const globalTimeout = config.timeout ?? DEFAULT_TIMEOUT;
  const globalHeaders = mergeHeaders(config.headers);
  const debug         = config.debug ?? isDev;

  // Security: freeze resolved config to prevent runtime mutation
  Object.freeze(config);

  // ── Sub-systems ──────────────────────────────────────────────────────────
  const authManager  = AuthManager.from(config.auth);
  const cacheManager = new CacheManager();

  // ── Interceptor chains ───────────────────────────────────────────────────
  const requestInterceptors  = new InterceptorManager<RequestContext>();
  const responseInterceptors = new InterceptorManager<XFetchResponse>();
  const errorInterceptors    = new InterceptorManager<XFetchError>();

  // ── Installed plugins ────────────────────────────────────────────────────
  const installedPlugins = new Set<string>();

  // ─────────────────────────────────────────────────────────────────────────
  // Core request pipeline
  // ─────────────────────────────────────────────────────────────────────────

  async function sendRequest<T>(
    method: HttpMethod,
    url: string,
    options: RequestOptions = {}
  ): Promise<XFetchResponse<T>> {

    // ── 1. Build initial request context ─────────────────────────────────
    let ctx: RequestContext = {
      url,
      method,
      headers: mergeHeaders(globalHeaders, options.headers),
      body: options.body,
      options,
      meta: options.meta ?? {},
    };

    // ── 2. Inject auth header ─────────────────────────────────────────────
    if (options.auth !== false) {
      authManager.injectHeader(ctx.headers);
    }

    // ── 3. Run request interceptors ───────────────────────────────────────
    try {
      ctx = await requestInterceptors.run(ctx);
    } catch (err) {
      throw await runErrorInterceptors(normalizeError(err, 'Request interceptor failed'));
    }

    // ── 4. Resolve effective options from (potentially mutated) context ───
    const effectiveOptions: RequestOptions = {
      ...ctx.options,
      headers: ctx.headers,
      body: ctx.body,
    };

    // ── 5. Dev logging — request ──────────────────────────────────────────
    const startTime = debug ? Date.now() : 0;
    if (debug) {
      logRequest(ctx.method, joinURL(baseURL, ctx.url), ctx.headers);
    }

    // BUG-9 FIX: generate cache key AFTER interceptors run, using ctx.method
    // (interceptors may have changed the method or URL).
    const cacheOpts = resolveCacheOptions(options, ctx.headers);
    const cacheKey  = generateCacheKey(ctx.method, joinURL(baseURL, ctx.url), ctx.body);

    // ── 6. Build the low-level resolved request ───────────────────────────
    const resolved: ResolvedRequest = {
      method:        ctx.method,
      url:           ctx.url,
      headers:       ctx.headers,
      options:       effectiveOptions,
      baseURL,
      globalTimeout,
      globalHeaders,
    };

    async function doFetch(): Promise<XFetchResponse<T>> {
      const retryOpts = resolveRetryOptions(options, config);
      return withRetry(
        () => executeRequest<T>(resolved),
        retryOpts,
        effectiveOptions.signal,
        ctx.method  // Security: enables idempotency check inside shouldRetry
      );
    }

    let response: XFetchResponse<T>;

    try {
      response = cacheOpts
        ? await cacheManager.getOrFetch<T>(cacheKey, cacheOpts, doFetch)
        : await doFetch();
    } catch (rawErr) {
      const xErr = normalizeError(rawErr, 'Request failed');

      // ── 7. Handle 401: attempt token refresh ─────────────────────────
      if (xErr.status === 401 && options.auth !== false && config.auth?.refreshToken) {
        try {
          response = await authManager.handleUnauthorized<XFetchResponse<T>>(
            xErr,
            async (newToken) => {
              // Retry with the refreshed token injected
              const refreshedHeaders = mergeHeaders(effectiveOptions.headers, {
                [authManager.headerName]: `${config.auth?.scheme ?? 'Bearer'} ${newToken}`,
              });
              return executeRequest<T>({ ...resolved, headers: refreshedHeaders });
            }
          );
        } catch (refreshOrRetryErr) {
          // BUG-8 FIX: propagate whichever error actually occurred (refresh err
          // or retry err), not silently replace it with the original 401.
          throw await runErrorInterceptors(normalizeError(refreshOrRetryErr, 'Auth refresh failed'));
        }
      } else {
        // ── 8. Run error interceptors ────────────────────────────────
        throw await runErrorInterceptors(xErr);
      }
    }

    // ── 9. Run response interceptors ──────────────────────────────────────
    try {
      response = (await responseInterceptors.run(
        response as unknown as XFetchResponse
      )) as XFetchResponse<T>;
    } catch (err) {
      throw await runErrorInterceptors(normalizeError(err, 'Response interceptor failed'));
    }

    // ── 10. Dev logging — response ────────────────────────────────────────
    if (debug) {
      logResponse(
        ctx.method,
        joinURL(baseURL, ctx.url),
        response.status,
        Date.now() - startTime,
        response.fromCache
      );
    }

    return response;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Error pipeline helper
  // ─────────────────────────────────────────────────────────────────────────

  async function runErrorInterceptors(err: XFetchError): Promise<XFetchError> {
    try {
      return await errorInterceptors.run(err);
    } catch (finalErr) {
      // If the error interceptor itself throws, surface that error
      return normalizeError(finalErr, 'Error interceptor failed');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public client object
  // ─────────────────────────────────────────────────────────────────────────

  const client: XFetchClient = {
    // ── HTTP method shorthands ─────────────────────────────────────────────

    get<T = unknown>(url: string, options?: RequestOptions) {
      return sendRequest<T>('GET', url, options);
    },

    post<T = unknown>(url: string, body?: unknown, options?: RequestOptions) {
      return sendRequest<T>('POST', url, { ...options, body });
    },

    put<T = unknown>(url: string, body?: unknown, options?: RequestOptions) {
      return sendRequest<T>('PUT', url, { ...options, body });
    },

    patch<T = unknown>(url: string, body?: unknown, options?: RequestOptions) {
      return sendRequest<T>('PATCH', url, { ...options, body });
    },

    delete<T = unknown>(url: string, options?: RequestOptions) {
      return sendRequest<T>('DELETE', url, options);
    },

    head(url: string, options?: RequestOptions) {
      return sendRequest<never>('HEAD', url, options);
    },

    request<T = unknown>(method: HttpMethod, url: string, options?: RequestOptions) {
      return sendRequest<T>(method, url, options);
    },

    // ── Auth helpers ───────────────────────────────────────────────────────

    setAuth(token: string) {
      authManager.setToken(token);
    },

    clearAuth() {
      authManager.clearToken();
    },

    // ── Plugin system ──────────────────────────────────────────────────────

    use(plugin: XFetchPlugin) {
      if (installedPlugins.has(plugin.name)) {
        if (debug) {
          console.warn(`[XFetch] Plugin "${plugin.name}" is already installed.`);
        }
        return client;
      }
      plugin.install(client);
      installedPlugins.add(plugin.name);
      return client;
    },

    // ── Interceptors API ───────────────────────────────────────────────────

    interceptors: {
      request: {
        use(fulfilled, rejected) {
          return requestInterceptors.use(fulfilled, rejected);
        },
        eject(id) {
          requestInterceptors.eject(id);
        },
      },
      response: {
        use(fulfilled, rejected) {
          return responseInterceptors.use(
            fulfilled,
            rejected as ((error: XFetchError) => XFetchResponse | Promise<XFetchResponse>) | undefined
          );
        },
        eject(id) {
          responseInterceptors.eject(id);
        },
      },
      error: {
        use(handler) {
          return errorInterceptors.use(handler);
        },
        eject(id) {
          errorInterceptors.eject(id);
        },
      },
    },
  };

  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes any thrown value into an XFetchError.
 * Centralizes the toXFetchError pattern used across 3+ call sites previously.
 */
function normalizeError(err: unknown, fallbackMessage: string): XFetchError {
  if (err instanceof XFetchError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new XFetchError({ message: `${fallbackMessage}: ${message}` });
}

function resolveCacheOptions(options: RequestOptions, headers?: Record<string, string>) {
  if (options.cache === false) return null;
  // Security: never cache requests that carry auth credentials
  if (headers) {
    const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());
    const hasAuth =
      headerKeys.includes('authorization') ||
      headerKeys.includes('cookie') ||
      headerKeys.includes('x-auth-token');
    if (hasAuth) return null;
  }
  return options.cache ?? null;
}

function resolveRetryOptions(
  options: RequestOptions,
  config: XFetchConfig
): RetryOptions {
  if (options.retry === false) return { count: 0 };
  return options.retry ?? config.retry ?? {};
}

/** Simple URL join used for logging only — not for actual fetch URL building. */
function joinURL(base: string, path: string): string {
  return base ? `${base.replace(/\/$/, '')}${path}` : path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev Logger (inline — keeps logger.ts as an optional plugin for consumers)
// ─────────────────────────────────────────────────────────────────────────────

/** 
 * Sensitive header names that must NOT appear in logs.
 * These would expose auth credentials or session identifiers.
 */
const SCRUBBED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'x-api-key',
  'proxy-authorization',
]);

/**
 * Returns a copy of the headers object with sensitive values redacted.
 * Safe to pass to console.log.
 */
function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] = SCRUBBED_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return safe;
}

const METHOD_COLORS: Record<string, string> = {
  get:    '#61affe',
  post:   '#49cc90',
  put:    '#fca130',
  patch:  '#50e3c2',
  delete: '#f93e3e',
  head:   '#9012fe',
};

const STATUS_COLORS = { ok: '#49cc90', error: '#f93e3e', default: '#999' } as const;

function methodColor(method: string): string {
  return METHOD_COLORS[method.toLowerCase()] ?? STATUS_COLORS.default;
}

function logRequest(method: string, url: string, headers: Record<string, string>) {
  const color = methodColor(method);
  // Security: scrub credentials from URL and auth headers before logging
  const safeURL = scrubURL(url);
  const safeHeaders = scrubHeaders(headers);
  if (typeof console.groupCollapsed === 'function') {
    console.groupCollapsed(
      `%c[XFetch] %c→ ${method.toUpperCase()} %c${safeURL}`,
      'color:#888;font-weight:normal',
      `color:${color};font-weight:bold`,
      'color:inherit;font-weight:normal'
    );
    console.log('Headers:', safeHeaders);
    console.groupEnd();
  } else {
    console.log(`[XFetch] → ${method.toUpperCase()} ${safeURL}`);
  }
}

function logResponse(
  method: string,
  url: string,
  status: number,
  durationMs: number,
  fromCache: boolean
) {
  const color = status < 400 ? STATUS_COLORS.ok : STATUS_COLORS.error;
  const cacheLabel = fromCache ? ' [CACHE]' : '';
  // Security: scrub credentials from the URL before logging
  const safeURL = scrubURL(url);
  if (typeof console.groupCollapsed === 'function') {
    console.groupCollapsed(
      `%c[XFetch] %c← ${method.toUpperCase()} %c${safeURL} %c${status}%c ${durationMs}ms${cacheLabel}`,
      'color:#888;font-weight:normal',
      `color:${methodColor(method)};font-weight:bold`,
      'color:inherit;font-weight:normal',
      `color:${color};font-weight:bold`,
      'color:#888;font-weight:normal'
    );
    console.groupEnd();
  } else {
    console.log(`[XFetch] ← ${method.toUpperCase()} ${safeURL} | ${status} | ${durationMs}ms${cacheLabel}`);
  }
}
