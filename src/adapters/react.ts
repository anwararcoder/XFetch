// ─────────────────────────────────────────────────────────────────────────────
// XFetch — React Adapter
//
// Provides:
//   • useRequest<T>(url, options?) — data-fetching hook with auto-fetch
//   • useApi<T>(client) — returns the configured client for imperative use
//
// Compatible with React 16.8+ (hooks) and works with React Query / SWR as
// a drop-in queryFn / fetcher.
//
// SSR Note: `useRequest` is always safe to render on the server. Data will
// be `null` on first render (both SSR and hydration); for SSR pre-loading use
// `getServerSideProps` with direct `api.get()` calls (see examples/).
// ─────────────────────────────────────────────────────────────────────────────

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type DependencyList,
} from 'react';

import type { XFetchClient, RequestOptions, XFetchResponse } from '../utils/types.js';
import { XFetchError } from '../utils/types.js';

// Re-export for consumers that import everything from 'xfetch/react'
export type { XFetchClient, RequestOptions, XFetchResponse };
export { XFetchError };

// ─────────────────────────────────────────────────────────────────────────────
// useRequest
// ─────────────────────────────────────────────────────────────────────────────

export interface UseRequestOptions<T> extends RequestOptions {
  /** Skip auto-fetch on mount — useful for forms, lazy loads, etc. Default: false */
  lazy?: boolean;
  /** Called when the request succeeds */
  onSuccess?: (data: T) => void;
  /** Called when the request fails */
  onError?: (error: XFetchError) => void;
  /** Override the cache key (useful for manual invalidation) */
  cacheKey?: string;
  /** Re-fetch whenever these deps change (like useEffect deps) */
  deps?: DependencyList;
}

export interface UseRequestResult<T> {
  /** The parsed response data, or null before the first successful response */
  data: T | null;
  /** True while a request is in flight */
  loading: boolean;
  /** The last error, or null if no error has occurred */
  error: XFetchError | null;
  /** Manually trigger (or re-trigger) the request */
  execute: () => Promise<XFetchResponse<T> | null>;
  /** Cancel the current in-flight request */
  cancel: () => void;
  /** Dismiss the current error */
  clearError: () => void;
}

/**
 * `useRequest<T>` — data-fetching hook
 *
 * @example
 * ```tsx
 * const { data, loading, error, execute } = useRequest<User[]>(
 *   api, '/users', { cache: { ttl: 60_000 } }
 * );
 * ```
 *
 * ### React Query compatibility
 * Use the `execute` function as a React Query `queryFn`:
 * ```ts
 * useQuery({ queryKey: ['users'], queryFn: () => execute() });
 * ```
 *
 * ### SWR compatibility
 * ```ts
 * useSWR('/users', () => api.get('/users').then(r => r.data));
 * ```
 */
export function useRequest<T = unknown>(
  client: XFetchClient,
  url: string,
  options: UseRequestOptions<T> = {}
): UseRequestResult<T> {
  // BUG-10 FIX: strip hook-only fields before forwarding to client.get()
  // lazy/onSuccess/onError/cacheKey/deps must not flow into the request pipeline
  const {
    lazy = false,
    onSuccess,
    onError,
    deps = [],
    cacheKey: _cacheKey,  // consumed here, not forwarded
    ...requestOptions
  } = options;

  const [data, setData]       = useState<T | null>(null);
  const [loading, setLoading] = useState(!lazy);
  const [error, setError]     = useState<XFetchError | null>(null);

  // Stable ref to abort controller so we can cancel from outside the effect
  const abortRef = useRef<AbortController | null>(null);

  const execute = useCallback(async (): Promise<XFetchResponse<T> | null> => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await client.get<T>(url, {
        ...requestOptions,
        signal: controller.signal,
      });

      setData(response.data);
      onSuccess?.(response.data);
      return response;
    } catch (err) {
      if (err instanceof XFetchError && err.isAborted) {
        // Intentional cancel — don't update error state
        return null;
      }
      const xErr = err instanceof XFetchError
        ? err
        : new XFetchError({ message: String(err) });

      setError(xErr);
      onError?.(xErr);
      return null;
    } finally {
      setLoading(false);
    }
  }, [client, url, ...deps]);

  // Auto-fetch on mount (unless lazy)
  useEffect(() => {
    if (!lazy) {
      void execute();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [execute]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { data, loading, error, execute, cancel, clearError };
}

// ─────────────────────────────────────────────────────────────────────────────
// useMutation — for POST / PUT / PATCH / DELETE
// ─────────────────────────────────────────────────────────────────────────────

export interface UseMutationOptions<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: XFetchError) => void;
  /** Invalidate cache keys after success */
  invalidates?: string[];
}

export interface UseMutationResult<TData, TBody = unknown> {
  mutate: (body: TBody) => Promise<XFetchResponse<TData> | null>;
  data: TData | null;
  loading: boolean;
  error: XFetchError | null;
  reset: () => void;
}

/**
 * `useMutation<TData, TBody>` — imperative mutation hook for write operations
 *
 * @example
 * ```tsx
 * const { mutate, loading } = useMutation<User, CreateUserBody>(
 *   api, 'POST', '/users'
 * );
 * await mutate({ name: 'Anwar' });
 * ```
 */
export function useMutation<TData = unknown, TBody = unknown>(
  client: XFetchClient,
  method: 'post' | 'put' | 'patch' | 'delete',
  url: string,
  options: UseMutationOptions<TData> = {}
): UseMutationResult<TData, TBody> {
  const { onSuccess, onError } = options;

  const [data, setData]       = useState<TData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<XFetchError | null>(null);

  const mutate = useCallback(
    async (body: TBody): Promise<XFetchResponse<TData> | null> => {
      setLoading(true);
      setError(null);
      try {
        // Cast body through `unknown` then to the expected second arg type
        const response = await (client[method] as (u: string, b: unknown) => Promise<XFetchResponse<TData>>)(url, body);
        setData(response.data);
        onSuccess?.(response.data);
        return response;
      } catch (err) {
        const xErr = err instanceof XFetchError
          ? err
          : new XFetchError({ message: String(err) });
        setError(xErr);
        onError?.(xErr);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client, method, url, onSuccess, onError]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { mutate, data, loading, error, reset };
}
