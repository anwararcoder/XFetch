# Client API

The central piece of XFetch is the `XFetchClient` class, usually instantiated via `createClient(options)`.

## `createClient(options)`

Returns a fresh client instance. Options override default settings:

- `baseURL`: string base URL.
- `headers`: object of default headers.
- `timeout`: default timeout in milliseconds.
- `retry`: Retry config.
- `cache`: Cache config.
- `auth`: Auth execution flow config.

## HTTP Methods

All standard HTTP methods are provided.

```typescript
const api = createClient({ baseURL: 'https://api.test' });

// They return promises resolving to `XFetchResponse<T>`
await api.get<T>(url, options?)
await api.post<T>(url, body?, options?)
await api.put<T>(url, body?, options?)
await api.patch<T>(url, body?, options?)
await api.delete<T>(url, options?)
```

## Interceptors

```typescript
// Request
api.interceptors.request.use((ctx) => {
    // Modify headers, URL, etc.
    return ctx;
});

// Response
api.interceptors.response.use((res) => {
    // Process response data globally
    return res;
});

// Error
api.interceptors.error.use((err) => {
    // Centralized error handling
    return err; // Remember to return or re-throw
});
```
