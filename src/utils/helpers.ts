/**
 * XFetch - Universal Fetch Client
 * Author: Anwar Ramadan
 * Company: AR-Coder Company
 */

// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Utility Helpers
// URL construction, header merging, environment detection, etc.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Environment Detection ───────────────────────────────────────────────────

/** True when running in a Node.js / SSR environment (no window object) */
export const isServer =
  typeof window === 'undefined' || typeof document === 'undefined';

/** True when running in a browser */
export const isBrowser = !isServer;

/** True when running in development mode */
export const isDev = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any)?.process?.env?.['NODE_ENV'] !== 'production';
  } catch {
    return false;
  }
})();

// ─── Security: Unsafe Protocol Blocklist ────────────────────────────────────

/**
 * Protocols that must never be used in outbound HTTP requests.
 * Blocking these prevents SSRF, local file reads, and script injection.
 */
const UNSAFE_PROTOCOLS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'gopher:',
  'ftp:',
];

/**
 * Validates a URL string against the unsafe protocol blocklist.
 * Throws immediately if a dangerous scheme is detected.
 *
 * @throws {Error} if the URL contains a blocked protocol
 */
export function validateURL(url: string): void {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('[XFetch] Invalid URL: must be a non-empty string.');
  }
  const normalized = url.trim().toLowerCase();
  for (const protocol of UNSAFE_PROTOCOLS) {
    if (normalized.startsWith(protocol)) {
      throw new Error(
        `[XFetch] Blocked unsafe protocol "${protocol}" in URL. Only http/https are allowed.`
      );
    }
  }
}

// ─── URL Utilities ───────────────────────────────────────────────────────────

/**
 * Joins a base URL with a path, normalizing duplicate slashes.
 * Validates both segments against the unsafe protocol blocklist.
 *
 * @example
 * buildURL('https://api.example.com/', '/users') // → 'https://api.example.com/users'
 * buildURL('', '/users')                         // → '/users'
 */
export function buildURL(base: string, path: string): string {
  // Security: block dangerous protocols before constructing any URL
  if (base) validateURL(base);
  validateURL(path.startsWith('/') || !base ? (base || '/') + path : path);

  if (!base) return path;
  // Strip trailing slash from base, ensure leading slash on path
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

/**
 * Scrubs sensitive credentials from a URL for safe logging.
 * Replaces embedded `user:password@` with `***:***@`.
 *
 * @example
 * scrubURL('https://admin:secret@api.example.com/data')
 * // → 'https://***:***@api.example.com/data'
 */
export function scrubURL(url: string): string {
  try {
    return url.replace(/(https?:\/\/)[^:@/]+:[^@/]+@/, '$1***:***@');
  } catch {
    return '[url scrub error]';
  }
}

/**
 * Appends query string parameters to a URL.
 * Skips null / undefined values automatically.
 *
 * @example
 * appendParams('/users', { page: 1, active: true }) // → '/users?page=1&active=true'
 */
export function appendParams(
  url: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  if (!params) return url;

  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null
  ) as [string, string | number | boolean][];

  if (entries.length === 0) return url;

  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

// ─── Header Utilities ─────────────────────────────────────────────────────────

/**
 * Merges multiple header objects, later entries win.
 * Header names are normalized to lowercase.
 */
/**
 * Keys that must never appear in headers — they are prototype pollution vectors.
 */
const FORBIDDEN_HEADER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function mergeHeaders(
  ...sources: (Record<string, string> | undefined | null)[]
): Record<string, string> {
  // Use null prototype to prevent prototype pollution on the result object
  const result = Object.create(null) as Record<string, string>;
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      const normalized = key.toLowerCase().trim();
      // Security: block prototype pollution keys
      if (FORBIDDEN_HEADER_KEYS.has(normalized)) continue;
      // Security: skip undefined/null header values to avoid 'undefined' strings
      if (value === undefined || value === null) continue;
      result[normalized] = String(value);
    }
  }
  return result;
}

/**
 * Converts a native Headers instance to a plain Record<string, string>.
 */
export function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

// ─── Body Serialization ───────────────────────────────────────────────────────

/**
 * Returns true if the body should be JSON-serialized.
 * Plain objects and arrays are serialized; FormData, Blob, etc. pass through.
 */
export function isJSONBody(body: unknown): body is object {
  return (
    body !== null &&
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams) &&
    !ArrayBuffer.isView(body)
  );
}

/**
 * Prepares the request body and returns the serialized value
 * plus any additional headers required (e.g. Content-Type).
 */
export function prepareBody(body: unknown): {
  serialized: BodyInit | null;
  extraHeaders: Record<string, string>;
} {
  if (body === undefined || body === null) {
    return { serialized: null, extraHeaders: {} };
  }

  if (isJSONBody(body)) {
    return {
      serialized: JSON.stringify(body),
      extraHeaders: { 'content-type': 'application/json' },
    };
  }

  // FormData, Blob, ArrayBuffer — let the browser set the correct Content-Type
  return { serialized: body as BodyInit, extraHeaders: {} };
}

// ─── Response Parsing ─────────────────────────────────────────────────────────

/**
 * Attempts to parse a Response body as JSON.
 * Falls back to plain text if the Content-Type is not application/json
 * or if JSON parsing fails.
 */
export async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  // Clone the response before reading — responses can only be consumed once
  const cloned = response.clone();

  try {
    if (contentType.includes('application/json')) {
      return await cloned.json();
    }

    if (
      contentType.includes('text/') ||
      contentType.includes('application/xml') ||
      contentType.includes('application/xhtml')
    ) {
      return await cloned.text();
    }

    // Binary or unknown — return ArrayBuffer
    return await cloned.arrayBuffer();
  } catch {
    // Fallback to text if parsing fails
    try {
      return await response.clone().text();
    } catch {
      return null;
    }
  }
}

// ─── Cache Key Generation ─────────────────────────────────────────────────────

/**
 * Generates a stable cache key from method + URL + serialized body.
 * Used by CacheManager to store and look up responses.
 */
export function generateCacheKey(
  method: string,
  url: string,
  body?: unknown
): string {
  const bodyStr =
    body !== undefined && body !== null
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : '';
  return `xfetch:${method.toUpperCase()}:${url}:${simpleHash(bodyStr)}`;
}

/**
 * A fast, non-cryptographic string hash (djb2).
 * Used only for cache key generation — NOT security-critical.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return (hash >>> 0).toString(36);
}

// ─── Misc Utilities ───────────────────────────────────────────────────────────

/**
 * Returns a promise that rejects after `ms` milliseconds.
 * Used alongside fetch() in a Promise.race() for timeout support.
 */
export function createTimeoutSignal(ms: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/**
 * Combines multiple AbortSignals into one.
 * Aborts as soon as any of the source signals abort.
 * Handles environments that don't support AbortSignal.any().
 */
export function combineSignals(signals: AbortSignal[]): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  // Use native AbortSignal.any() where available (Node 20+, modern browsers)
  if (typeof AbortSignal.any === 'function') {
    return {
      signal: AbortSignal.any(signals),
      cleanup: () => { /* no-op — native implementation handles cleanup */ },
    };
  }

  // Polyfill for older environments
  const controller = new AbortController();
  const listeners: Array<() => void> = [];

  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      break;
    }
    const handler = () => controller.abort(sig.reason);
    sig.addEventListener('abort', handler, { once: true });
    listeners.push(() => sig.removeEventListener('abort', handler));
  }

  return {
    signal: controller.signal,
    cleanup: () => listeners.forEach((fn) => fn()),
  };
}

/** Sleep for `ms` milliseconds, respecting an optional abort signal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}
