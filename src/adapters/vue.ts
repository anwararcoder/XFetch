/**
 * XFetch - Universal Fetch Client
 * Author: Anwar Ramadan
 * Company: AR-Coder Company
 */

// ─────────────────────────────────────────────────────────────────────────────
// XFetch — Vue 3 Adapter
//
// Provides:
//   • useApi<T>(client, url, options?) — composable with reactive state
//   • useApiMutation<T>(client, method, url) — composable for write operations
//
// SSR / Nuxt: Use `useAsyncData(() => client.get('/endpoint').then(r => r.data))`
// for Nuxt-managed SSR hydration (see examples/nuxt/).
//
// Vue version: Requires Vue 3.x (Composition API + Ref)
// ─────────────────────────────────────────────────────────────────────────────

import { ref, onMounted, onBeforeUnmount, watch, shallowRef, type Ref } from 'vue';
import type { WatchSource } from 'vue';

import type { XFetchClient, RequestOptions, XFetchResponse } from '../utils/types.js';
import { XFetchError } from '../utils/types.js';

// Re-export for consumers
export type { XFetchClient, RequestOptions, XFetchResponse };
export { XFetchError };

// ─────────────────────────────────────────────────────────────────────────────
// useApi
// ─────────────────────────────────────────────────────────────────────────────

export interface UseApiOptions<T> extends RequestOptions {
  /** If true, does not auto-fetch on mount */
  lazy?: boolean;
  /** Vue watch sources — re-fetches when any source changes */
  watchSources?: WatchSource[];
  /** Called on successful response */
  onSuccess?: (data: T) => void;
  /** Called on error */
  onError?: (error: XFetchError) => void;
}

export interface UseApiReturn<T> {
  /** Reactive data (null before first success) */
  data: Ref<T | null>;
  /** True while request is in flight */
  loading: Ref<boolean>;
  /** Last error (null if none) */
  error: Ref<XFetchError | null>;
  /** Manually trigger / re-trigger the request */
  execute: () => Promise<XFetchResponse<T> | null>;
  /** Cancel the current in-flight request */
  cancel: () => void;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * `useApi<T>` — Vue 3 composable for data fetching
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useApi } from 'xfetch/vue';
 *
 * const { data, loading, error } = useApi<User[]>(api, '/users');
 * </script>
 * ```
 *
 * ### Nuxt compatibility
 * Wrap with `useAsyncData` for SSR:
 * ```ts
 * const { data } = await useAsyncData('users', () =>
 *   api.get<User[]>('/users').then(r => r.data)
 * );
 * ```
 */
export function useApi<T = unknown>(
  client: XFetchClient,
  url: string,
  options: UseApiOptions<T> = {}
): UseApiReturn<T> {
  // BUG-10 FIX: strip hook-only fields before forwarding options to client.get()
  const { lazy = false, watchSources = [], onSuccess, onError, ...requestOptions } = options;

  const data    = shallowRef<T | null>(null);
  const loading = ref(!lazy);
  const error   = ref<XFetchError | null>(null);

  let abortController: AbortController | null = null;

  const execute = async (): Promise<XFetchResponse<T> | null> => {
    // Cancel any existing in-flight request
    abortController?.abort();
    abortController = new AbortController();

    loading.value = true;
    error.value   = null;

    try {
      const response = await client.get<T>(url, {
        ...requestOptions,
        signal: abortController.signal,
      });
      data.value = response.data;
      onSuccess?.(response.data);
      return response;
    } catch (err) {
      if (err instanceof XFetchError && err.isAborted) return null;

      const xErr = err instanceof XFetchError
        ? err
        : new XFetchError({ message: String(err) });

      error.value = xErr;
      onError?.(xErr);
      return null;
    } finally {
      loading.value = false;
    }
  };

  // Auto-fetch on mount (CSR) — skip on SSR (no window)
  onMounted(() => {
    if (!lazy) {
      void execute();
    }
  });

  // Cancel on component unmount
  onBeforeUnmount(() => {
    abortController?.abort();
  });

  // Re-fetch when watch sources change
  if (watchSources.length > 0) {
    watch(watchSources, () => {
      void execute();
    });
  }

  const cancel = () => {
    abortController?.abort();
  };

  const clearError = () => {
    error.value = null;
  };

  return { data, loading, error, execute, cancel, clearError };
}

// ─────────────────────────────────────────────────────────────────────────────
// useApiMutation — write operations
// ─────────────────────────────────────────────────────────────────────────────

export interface UseApiMutationReturn<TData, TBody = unknown> {
  mutate: (body: TBody) => Promise<XFetchResponse<TData> | null>;
  data: Ref<TData | null>;
  loading: Ref<boolean>;
  error: Ref<XFetchError | null>;
  reset: () => void;
}

/**
 * `useApiMutation<T>` — Vue 3 composable for write operations
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const { mutate, loading } = useApiMutation<User, CreateUserBody>(
 *   api, 'post', '/users'
 * );
 * await mutate({ name: 'Anwar' });
 * </script>
 * ```
 */
export function useApiMutation<TData = unknown, TBody = unknown>(
  client: XFetchClient,
  method: 'post' | 'put' | 'patch' | 'delete',
  url: string,
  options: { onSuccess?: (data: TData) => void; onError?: (error: XFetchError) => void } = {}
): UseApiMutationReturn<TData, TBody> {
  const { onSuccess, onError } = options;

  const data    = shallowRef<TData | null>(null);
  const loading = ref(false);
  const error   = ref<XFetchError | null>(null);

  const mutate = async (body: TBody): Promise<XFetchResponse<TData> | null> => {
    loading.value = true;
    error.value   = null;
    try {
      const response = await (client[method] as (u: string, b: unknown) => Promise<XFetchResponse<TData>>)(url, body);
      data.value = response.data;
      onSuccess?.(response.data);
      return response;
    } catch (err) {
      const xErr = err instanceof XFetchError
        ? err
        : new XFetchError({ message: String(err) });
      error.value = xErr;
      onError?.(xErr);
      return null;
    } finally {
      loading.value = false;
    }
  };

  const reset = () => {
    data.value    = null;
    error.value   = null;
    loading.value = false;
  };

  return { mutate, data, loading, error, reset };
}
