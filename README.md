# 🚀 XFetch

**Universal HTTP fetching library** — framework-agnostic, SSR-safe, TypeScript-first, zero runtime dependencies.

_Created and maintained by Anwar Ramadan (AR-Coder Company)_

<p align="left">
  <a href="https://www.npmjs.com/package/@ar-coder/xfetch">
    <img src="https://img.shields.io/npm/v/@ar-coder/xfetch.svg?color=blue&style=flat-square" alt="npm version">
  </a>

  <a href="https://www.npmjs.com/package/@ar-coder/xfetch">
    <img src="https://img.shields.io/npm/dt/@ar-coder/xfetch.svg?color=green&style=flat-square" alt="downloads">
  </a>

  <a href="https://github.com/anwararcoder/XFetch/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/anwararcoder/XFetch/ci.yml?branch=main&style=flat-square" alt="Build Status">
  </a>
  
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-ready-blue.svg?style=flat-square" alt="TypeScript">
  </a>
  
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License: MIT">
  </a>
</p>

> Built entirely on native `fetch`. Inspired by Axios but designed for the modern web. From a classic `<script>` tag or jQuery application to a Next.js Server Components setup.

---

## 🌟 Features

- 🚀 **Zero dependencies** — Only uses modern, native `fetch`. Compatible with Node 18+, browsers, Edge Runtime, Bun, and Deno.
- 🔁 **Interceptors** — Axios-style request, response, and error middleware chains.
- ⚡ **Smart Retry** — Built-in exponential backoff with jitter and customizable status code handling.
- 🗄️ **Advanced Caching** — Memory and LocalStorage backends, TTL-based eviction, and automatic request deduplication (no redundant network calls).
- 🔐 **Auth Management** — Effortless Bearer token injection with a fully integrated 401 token refresh flow.
- ❌ **Cancellation** — Seamless AbortController-based request timeouts and manual cancellation without leaks.
- 🔌 **Plugin System** — Highly extensible architecture. Extend the client safely without modifying the core.
- ⚛️ **React / Next.js Ready** — Includes `useRequest()` and `useMutation()` hooks.
- 🟢 **Vue / Nuxt Ready** — Includes `useApi()` and `useApiMutation()` composables.
- 📦 **UMD Build** — Drop-in global via CDN, fully compatible with legacy stacks like jQuery.
- 🌐 **Isomorphic & SSR-safe** — Runs perfectly during SSR without browser-specific polyfills or memory leaks.

---

## 📦 Installation

```bash
npm install @ar-coder/xfetch
# or
pnpm add @ar-coder/xfetch
# or
yarn add @ar-coder/xfetch
```

**Using via CDN (UMD browser build):**

```html
<script src="https://cdn.jsdelivr.net/npm/@ar-coder/xfetch/dist/xfetch.umd.js"></script>
```

---

## 🚀 Quick Start

Creating an instance allows you to encapsulate base URLs, default headers, and global configurations such as cache and retry strategies.

```ts
import { createClient } from "@ar-coder/xfetch";

const api = createClient({
  baseURL: "https://api.example.com",
  headers: {
    Accept: "application/json",
  },
});

// GET with automatic TypeScript inference
const { data } = await api.get<User[]>("/users");

// POST — objects are automatically serialized to JSON
await api.post("/users", { name: "Anwar", role: "admin" });

// Seamless REST support
await api.put("/users/1", { name: "Updated" });
await api.patch("/users/1", { active: false });
await api.delete("/users/1");
```

---

## 📖 Framework Usage

### React & Next.js

XFetch exposes custom hooks directly from `xfetch/react`. These hooks are strictly typed and handle loading/error states out of the box.

```tsx
import { createClient } from "@ar-coder/xfetch";
import { useRequest, useMutation } from "@ar-coder/xfetch/react";

const api = createClient({ baseURL: "https://api.example.com" });

function UserList() {
  const { data, loading, error, execute } = useRequest<User[]>(api, "/users");

  if (loading) return <div>Loading...</div>;
  if (error)
    return <div onClick={execute}>Error: {error.message} - Retry?</div>;

  return (
    <ul>
      {data?.map((u) => (
        <li key={u.id}>{u.name}</li>
      ))}
    </ul>
  );
}

function CreateUser() {
  const { mutate, loading } = useMutation<User, CreateUserInput>(
    api,
    "post",
    "/users",
  );

  return (
    <button onClick={() => mutate({ name: "Anwar", email: "me@example.com" })}>
      {loading ? "Creating..." : "Create User"}
    </button>
  );
}
```

### Vue 3 & Nuxt

XFetch exposes composables from `xfetch/vue`. They automatically integrate with Vue's reactivity system.

```vue
<script setup lang="ts">
import { ref } from "vue";
import { createClient } from "@ar-coder/xfetch";
import { useApi, useApiMutation } from "@ar-coder/xfetch/vue";

const api = createClient({ baseURL: "/api" });

// Standard reactive data fetching
const { data, loading, error, execute } = useApi<User[]>(api, "/users");

// Watch reactive properties and auto-refetch
const page = ref(1);
const { data: pagedData } = useApi<User[]>(api, "/users", {
  watchSources: [page],
  params: { page: page.value },
});

// Mutations
const { mutate: createUser } = useApiMutation<User, CreateUserInput>(
  api,
  "post",
  "/users",
);
</script>
```

### Server-Side Rendering (SSR)

XFetch distinguishes itself by seamlessly executing on the server without memory leaks or missing global object errors (`window is not defined`).

**Next.js (App Router / Server Components):**

```tsx
import { createClient } from "@ar-coder/xfetch";
const api = createClient({ baseURL: "https://api.example.com" });

export default async function Page() {
  // `cache` and other node-specific deduplication methods work inherently
  const { data: users } = await api.get<User[]>("/users");
  return <UserList users={users} />;
}
```

**Nuxt 3 UseAsyncData:**

```ts
const api = createClient({ baseURL: "/api" });

// useAsyncData ensures the fetch isn't duplicated on the client-side swap
const { data } = await useAsyncData("users", () =>
  api.get<User[]>("/users").then((res) => res.data),
);
```

### Vanilla JS & jQuery

XFetch is exported over `XFetch` global object when imported through a `<script>` tag. It works flawlessly in older environments like jQuery projects!

```html
<script src="https://cdn.jsdelivr.net/npm/@ar-coder/xfetch/dist/xfetch.umd.js"></script>
<script>
  const api = XFetch.createClient({ baseURL: "https://api.example.com" });

  // Use as replacement for $.ajax
  $("#load-btn").on("click", async function () {
    try {
      const { data } = await api.get("/users");
      $("#list").html(data.map((u) => `<li>${u.name}</li>`).join(""));
    } catch (err) {
      console.error("Request failed: ", err.status);
    }
  });
</script>
```

---

## 🛠 Advanced Usage

### Interceptors

Like Axios, you can intercept requests or responses before they are handled by `then` or `catch`.

```ts
// 1. Add headers before every request
api.interceptors.request.use((ctx) => {
  ctx.headers["X-Request-ID"] = crypto.randomUUID();
  return ctx;
});

// 2. Transform the response or track analytical metrics
api.interceptors.response.use((res) => {
  console.log(
    `[${res.status}] ${res.request.url} matched cache:`,
    res.fromCache,
  );
  return res;
});

// 3. Centralized error handling
api.interceptors.error.use((err) => {
  if (err.status === 403) window.location.href = "/login";
  return err; // re-throw so the local catch block still works
});
```

### Caching

Stop waiting on redundant data using robust integrated caching. Two modes exist: `memory` (default) and `localStorage` (persists cross-tab).

```ts
const api = createClient({
  baseURL: "https://api.example.com",
  // Setup global caching
  cache: {
    storage: "memory",
    ttl: 5 * 60 * 1000, // Cache lives for 5 minutes
  },
});

// Force fetching logic per-request:
await api.get("/always-fresh", { cache: false });
await api.get("/use-local-storage", {
  cache: { storage: "localStorage", ttl: 3600000 },
});
```

### Retry Strategy

Flaky network connection? Setup exponential backoff retries explicitly.

```ts
const api = createClient({
  baseURL: "https://api.example.com",
  retry: {
    count: 3, // Try 3 total times (1 initial + 3 retries = 4 max requests)
    delay: 500, // Exponentially wait: 500ms -> 1000ms -> 2000ms
    maxDelay: 5000,
    statusCodes: [408, 429, 500, 502, 503, 504], // Only retry on safe errors
  },
});

// Or disable for an explicit request:
await api.post("/transaction/process", { amount: 50 }, { retry: false });
```

### Authorization Management

Instead of injecting your tokens via interceptor manually every time, use the powerful built-in auth manager with a native refresh flow implementation.

```ts
const api = createClient({
  baseURL: "https://api.example.com",
  auth: {
    token: null, // Initially unauthenticated
    // Intercepts 401 unauthorized errors, pauses queue, refreshes, resolves, and plays retry
    refreshToken: async () => {
      const res = await fetch("/api/auth/refresh", { method: "POST" });
      const json = await res.json();
      return json.token; // Pass new token
    },
  },
});

// Set state immediately when login is complete:
api.setAuth("my_new_oauth_token_123");

// Cleans queue + interceptor on logout:
api.clearAuth();
```

---

## 🤝 Contributing

We welcome community contributions constraints via Pull Requests. Please see our `CONTRIBUTING.md` guidelines for information.

1. Clone the repo: `git clone https://github.com/anwararcoder/XFetch.git`
2. Install dependencies: `npm install`
3. Make changes in a new branch: `git checkout -b fix-auth`
4. Run validation scripts:
   ```bash
   npm run lint        # Code styling correctness
   npm run typecheck   # TS compiler validation
   npm run test        # Execute 170+ Vitest specifications
   ```
5. Submit a pull request!

---

## 👨‍💻 About the Author

**Anwar Ramadan** is a Senior Software Engineer passionate about open-source and modern web architectures. This project is maintained under the umbrella of **AR-Coder Company**, dedicated to building precise, production-grade developer tooling.

- **GitHub:** [@anwararcoder](https://github.com/anwararcoder)
- **Company:** AR-Coder Company

---

## 📝 License

Released under the [MIT License](LICENSE). Copyright &copy; 2026 Anwar Ramadan - AR-Coder Company.
