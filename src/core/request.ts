// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Core Request Runner
//
// The low-level engine that executes a single HTTP request using native fetch.
// Handles: timeout, AbortSignal, JSON parsing, and XFetchError construction.
// Retry and caching are applied at a higher level (client.ts).
// ─────────────────────────────────────────────────────────────────────────────

import {
  XFetchError,
  type HttpMethod,
  type RequestOptions,
  type XFetchResponse,
} from '../utils/types.js';

import {
  buildURL,
  appendParams,
  mergeHeaders,
  headersToRecord,
  prepareBody,
  parseResponseBody,
  createTimeoutSignal,
  combineSignals,
} from '../utils/helpers.js';

// ─── Internal request params (fully resolved, no optionals) ──────────────────

export interface ResolvedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  options: RequestOptions;
  baseURL: string;
  globalTimeout: number;
  globalHeaders: Record<string, string>;
}

// ─── Core execution ───────────────────────────────────────────────────────────

/**
 * Executes a single HTTP request with the given resolved parameters.
 * Does NOT handle retry or caching — those are layered on top.
 *
 * @throws {XFetchError} always — on network errors, timeouts, and non-2xx responses
 */
export async function executeRequest<T = unknown>(
  resolved: ResolvedRequest
): Promise<XFetchResponse<T>> {
  const { method, options, baseURL, globalTimeout, globalHeaders } = resolved;

  // ── 1. Build final URL ────────────────────────────────────────────────────
  const rawURL = buildURL(baseURL, resolved.url);
  const finalURL = appendParams(rawURL, options.params);

  // ── 2. Merge headers (global → per-request) ───────────────────────────────
  const { serialized: body, extraHeaders: bodyHeaders } = prepareBody(options.body);

  const headers = mergeHeaders(
    { accept: 'application/json, text/plain, */*' },
    globalHeaders,
    bodyHeaders,
    options.headers
  );

  // ── 3. Build the Request object ───────────────────────────────────────────
  const request = new Request(finalURL, {
    method,
    headers,
    body: body ?? undefined,
  });

  // ── 4. Set up timeout + external signal ───────────────────────────────────
  const timeoutMs = options.timeout ?? globalTimeout;
  const { signal: timeoutSignal, clear: clearHttpTimeout } =
    createTimeoutSignal(timeoutMs);

  const signals: AbortSignal[] = [timeoutSignal];
  if (options.signal) signals.push(options.signal);

  const { signal: combinedSignal, cleanup: cleanupSignal } =
    combineSignals(signals);

  // ── 5. Execute fetch ──────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(request, { signal: combinedSignal });
  } catch (err) {
    // BUG-6 FIX: handle both DOMException and plain Error with name 'AbortError'
    // Node 18+ fetch throws a plain Error, not a DOMException, on abort.
    const isAbortError =
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && err.name === 'AbortError');

    if (isAbortError) {
      // Distinguish timeout abort from user-initiated abort
      const isTimeout = timeoutSignal.aborted;
      throw new XFetchError({
        message: isTimeout
          ? `Request timed out after ${timeoutMs}ms`
          : 'Request was aborted',
        isTimeout,
        isAborted: !isTimeout,
        isNetworkError: false,
        request,
      });
    }

    throw new XFetchError({
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      isNetworkError: true,
      request,
    });
  } finally {
    // BUG-5 FIX: only clean up here (in finally), not also in the catch block.
    // Previously cleanup was called in both catch AND finally (double-call).
    clearHttpTimeout();
    cleanupSignal();
  }

  // ── 6. Parse response body ────────────────────────────────────────────────
  const data = options.raw
    ? (response as unknown as T)
    : ((await parseResponseBody(response)) as T);

  // ── 7. Handle non-2xx status ──────────────────────────────────────────────
  if (!response.ok) {
    throw new XFetchError({
      message: `Request failed with status ${response.status} ${response.statusText}`,
      status: response.status,
      statusText: response.statusText,
      data,
      request,
      response,
    });
  }

  // ── 8. Return typed response wrapper ─────────────────────────────────────
  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: headersToRecord(response.headers),
    fromCache: false,
    request,
    response,
  };
}
