// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Logger Plugin
//
// A plugin that adds rich, color-coded request/response logging.
// Automatically installs request and response interceptors.
//
// Usage:
//   import { loggerPlugin } from 'xfetch';
//   const api = createClient({ baseURL: '/api' }).use(loggerPlugin);
//
// Only recommended in development. In production, use `debug: false` in config.
// ─────────────────────────────────────────────────────────────────────────────

import type { XFetchPlugin, XFetchClient, RequestContext, XFetchResponse } from '../utils/types.js';

export interface LoggerPluginOptions {
  /** Whether to log request headers. Default: false */
  logHeaders?: boolean;
  /** Whether to log request/response body. Default: false */
  logBody?: boolean;
  /** Custom log prefix. Default: '[XFetch]' */
  prefix?: string;
}

/**
 * Creates a logger plugin with the specified options.
 *
 * @example
 * ```ts
 * import { createClient, createLoggerPlugin } from 'xfetch';
 *
 * const api = createClient({ baseURL: '/api' })
 *   .use(createLoggerPlugin({ logHeaders: true, logBody: true }));
 * ```
 */
export function createLoggerPlugin(options: LoggerPluginOptions = {}): XFetchPlugin {
  const {
    logHeaders = false,
    logBody = false,
    prefix = '[XFetch]',
  } = options;

  // Track timing per request
  const timings = new Map<string, number>();

  return {
    name: 'xfetch-logger',

    install(client: XFetchClient) {
      // ── Request interceptor ──────────────────────────────────────────────
      client.interceptors.request.use((ctx: RequestContext) => {
        const key = `${ctx.method}:${ctx.url}:${Date.now()}`;
        timings.set(key, Date.now());

        const color = getMethodColor(ctx.method);

        console.groupCollapsed(
          `%c${prefix} %c→ ${ctx.method} %c${ctx.url}`,
          'color:#888',
          `color:${color};font-weight:bold`,
          'color:inherit'
        );

        if (logHeaders) {
          console.log('Headers:', ctx.headers);
        }

        if (logBody && ctx.body !== undefined) {
          console.log('Body:', ctx.body);
        }

        console.groupEnd();

        // Store key reference in meta for the response interceptor
        (ctx.meta as Record<string, unknown>)['__logKey'] = key;
        return ctx;
      });

      // ── Response interceptor ─────────────────────────────────────────────
      client.interceptors.response.use((res: XFetchResponse) => {
        const key = res.request
          ? `${res.request.method}:${new URL(res.request.url).pathname}:${0}`
          : '';
        const startTime = timings.get(key);
        const duration = startTime ? `${Date.now() - startTime}ms` : '?ms';
        timings.delete(key);

        const statusColor = res.status < 400 ? '#49cc90' : '#f93e3e';
        const cacheLabel = res.fromCache ? ' [CACHE HIT]' : '';

        console.groupCollapsed(
          `%c${prefix} %c← ${res.status} ${res.statusText}%c ${duration}${cacheLabel}`,
          'color:#888',
          `color:${statusColor};font-weight:bold`,
          'color:#888'
        );

        if (logHeaders) {
          console.log('Response Headers:', res.headers);
        }

        if (logBody) {
          console.log('Data:', res.data);
        }

        console.groupEnd();

        return res;
      });

      // ── Error interceptor ────────────────────────────────────────────────
      client.interceptors.error.use((err) => {
        console.groupCollapsed(
          `%c${prefix} %c✗ ${err.status ?? 'ERR'} ${err.message}`,
          'color:#888',
          'color:#f93e3e;font-weight:bold'
        );
        console.log('Details:', err.toJSON());
        console.groupEnd();
        return err;
      });
    },
  };
}

/** Pre-built logger plugin with defaults (no headers/body logging) */
export const loggerPlugin = createLoggerPlugin();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: '#61affe',
    POST: '#49cc90',
    PUT: '#fca130',
    PATCH: '#50e3c2',
    DELETE: '#f93e3e',
    HEAD: '#9012fe',
  };
  return colors[method.toUpperCase()] ?? '#999';
}
