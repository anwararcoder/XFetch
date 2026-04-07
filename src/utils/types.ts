/**
 * XFetch - Universal Fetch Client
 * Author: Anwar Ramadan
 * Company: AR-Coder Company
 */

// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Type Definitions
// Central location for all TypeScript interfaces, types, and enums.
// ─────────────────────────────────────────────────────────────────────────────

// ─── HTTP Methods ─────────────────────────────────────────────────────────────

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

// ─── Response Wrapper ─────────────────────────────────────────────────────────

/**
 * The typed response returned by every XFetch request.
 * @template T The shape of the parsed response body.
 */
export interface XFetchResponse<T = unknown> {
  /** The parsed response body */
  data: T;
  /** HTTP status code (e.g. 200, 404) */
  status: number;
  /** HTTP status text (e.g. "OK", "Not Found") */
  statusText: string;
  /** Response headers as a plain object */
  headers: Record<string, string>;
  /** Whether this response came from cache */
  fromCache: boolean;
  /** Original Request instance (for diagnostics) */
  request: Request;
  /** Original Response instance */
  response: Response;
}

// ─── Cache Options ────────────────────────────────────────────────────────────

export type CacheStorage = 'memory' | 'localStorage' | 'none';

export interface CacheOptions {
  /** Which cache backend to use. Default: 'memory' */
  storage?: CacheStorage;
  /** Time-to-live in milliseconds. Default: 5 minutes */
  ttl?: number;
  /** Custom cache key (overrides auto-generated key) */
  key?: string;
  /** Force a fresh request, bypassing cache */
  bypass?: boolean;
}

// ─── Retry Options ────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Max number of retry attempts. Default: 3 */
  count?: number;
  /** Base delay in ms between retries (exponential backoff). Default: 500 */
  delay?: number;
  /** Max delay cap in ms. Default: 30_000 */
  maxDelay?: number;
  /** HTTP status codes that should trigger a retry. Default: [408, 429, 500, 502, 503, 504] */
  statusCodes?: number[];
  /**
   * Custom condition function — return true to retry.
   * Overrides default status-code check if provided.
   */
  condition?: (error: XFetchError) => boolean;
  /**
   * HTTP methods eligible for retry. By default only idempotent methods are retried
   * (GET, HEAD, OPTIONS, PUT, DELETE). Add 'POST' or 'PATCH' here to opt-in to
   * retrying non-idempotent methods — use with caution to avoid duplicate side-effects.
   * @default ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']
   */
  allowedMethods?: string[];
}

// ─── Auth Options ─────────────────────────────────────────────────────────────

export interface AuthOptions {
  /** Bearer token to inject into Authorization header */
  token?: string;
  /**
   * Called when a 401 response is received.
   * Should return a new token string, or null to abort.
   */
  refreshToken?: () => Promise<string | null>;
  /** Header name to use. Default: 'Authorization' */
  headerName?: string;
  /** Token prefix. Default: 'Bearer' */
  scheme?: string;
}

// ─── Per-Request Options ──────────────────────────────────────────────────────

export interface RequestOptions {
  /** Additional headers to merge with global defaults */
  headers?: Record<string, string>;
  /** Request body — will be JSON.stringify'd if object */
  body?: unknown;
  /** Query string parameters */
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Timeout in milliseconds. Default: uses client config or 30_000 */
  timeout?: number;
  /** Cache configuration for this request */
  cache?: CacheOptions | false;
  /** Retry configuration for this request */
  retry?: RetryOptions | false;
  /** Auth configuration for this request (overrides client-level auth) */
  auth?: AuthOptions | false;
  /** Optional AbortSignal for external cancellation */
  signal?: AbortSignal;
  /** Skip response body parsing (returns raw Response) */
  raw?: boolean;
  /** Arbitrary metadata passed through the interceptor chain */
  meta?: Record<string, unknown>;
}

// ─── Client Config ────────────────────────────────────────────────────────────

export interface XFetchConfig {
  /** Prepended to every request URL */
  baseURL?: string;
  /** Default headers sent with every request */
  headers?: Record<string, string>;
  /** Global timeout in ms. Default: 30_000 */
  timeout?: number;
  /** Global retry config */
  retry?: RetryOptions;
  /** Global cache config */
  cache?: CacheOptions;
  /** Global auth config */
  auth?: AuthOptions;
  /**
   * Enable dev-mode request/response logging.
   * Automatically true when process.env.NODE_ENV !== 'production'.
   */
  debug?: boolean;
}

// ─── Interceptors ─────────────────────────────────────────────────────────────

/** Internal interceptor record */
export interface InterceptorRecord<T> {
  id: number;
  fulfilled: (value: T) => T | Promise<T>;
  rejected?: (error: XFetchError) => T | Promise<T>;
}

/** Public handle returned by interceptors.use() */
export interface InterceptorHandle {
  id: number;
}

/** Request context passed through request interceptors */
export interface RequestContext {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: unknown;
  options: RequestOptions;
  meta: Record<string, unknown>;
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export interface XFetchClient {
  get<T = unknown>(url: string, options?: RequestOptions): Promise<XFetchResponse<T>>;
  post<T = unknown>(url: string, body?: unknown, options?: RequestOptions): Promise<XFetchResponse<T>>;
  put<T = unknown>(url: string, body?: unknown, options?: RequestOptions): Promise<XFetchResponse<T>>;
  patch<T = unknown>(url: string, body?: unknown, options?: RequestOptions): Promise<XFetchResponse<T>>;
  delete<T = unknown>(url: string, options?: RequestOptions): Promise<XFetchResponse<T>>;
  head(url: string, options?: RequestOptions): Promise<XFetchResponse<never>>;
  request<T = unknown>(method: HttpMethod, url: string, options?: RequestOptions): Promise<XFetchResponse<T>>;
  setAuth(token: string): void;
  clearAuth(): void;
  use(plugin: XFetchPlugin): XFetchClient;
  interceptors: {
    request: {
      use(
        fulfilled: (ctx: RequestContext) => RequestContext | Promise<RequestContext>,
        rejected?: (error: XFetchError) => RequestContext | Promise<RequestContext>
      ): InterceptorHandle;
      eject(id: number): void;
    };
    response: {
      use(
        fulfilled: (res: XFetchResponse) => XFetchResponse | Promise<XFetchResponse>,
        rejected?: (error: XFetchError) => XFetchResponse | Promise<XFetchResponse>
      ): InterceptorHandle;
      eject(id: number): void;
    };
    error: {
      use(
        handler: (error: XFetchError) => XFetchError | Promise<XFetchError>
      ): InterceptorHandle;
      eject(id: number): void;
    };
  };
}

export interface XFetchPlugin {
  /** Unique plugin name */
  name: string;
  /**
   * Called once when the plugin is installed on a client.
   * Receives the client instance so plugins can register interceptors, etc.
   */
  install(client: XFetchClient, options?: Record<string, unknown>): void;
}

// ─── Custom Error ─────────────────────────────────────────────────────────────

/**
 * All XFetch errors are instances of this class.
 * Provides strongly-typed access to HTTP status, message, and response body.
 */
export class XFetchError extends Error {
  /** HTTP status code, if the error originated from a response */
  public readonly status: number | undefined;
  /** HTTP status text */
  public readonly statusText: string | undefined;
  /** Parsed response body (if available) */
  public readonly data: unknown;
  /** Whether this was a network-level error (fetch itself failed) */
  public readonly isNetworkError: boolean;
  /** Whether this was a timeout */
  public readonly isTimeout: boolean;
  /** Whether the request was aborted */
  public readonly isAborted: boolean;
  /** Original Response object (if available) */
  public readonly response: Response | undefined;
  /** Original Request object */
  public readonly request: Request | undefined;

  constructor(params: {
    message: string;
    status?: number;
    statusText?: string;
    data?: unknown;
    isNetworkError?: boolean;
    isTimeout?: boolean;
    isAborted?: boolean;
    response?: Response;
    request?: Request;
  }) {
    super(params.message);
    this.name = 'XFetchError';
    this.status = params.status;
    this.statusText = params.statusText;
    this.data = params.data;
    this.isNetworkError = params.isNetworkError ?? false;
    this.isTimeout = params.isTimeout ?? false;
    this.isAborted = params.isAborted ?? false;
    this.response = params.response;
    this.request = params.request;

    // Preserve correct prototype chain in transpiled code
    Object.setPrototypeOf(this, XFetchError.prototype);
  }

  /** Returns a plain object safe to serialize/log */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      data: this.data,
      isNetworkError: this.isNetworkError,
      isTimeout: this.isTimeout,
      isAborted: this.isAborted,
    };
  }
}
