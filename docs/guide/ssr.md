# SSR Support

## Nuxt & Next.js Ecosystems

XFetch guarantees complete SSR safety. `fetch` runs natively inside Node.js 18+. Memory caching (`storage: "memory"`) allows global instance caching logic that safely isolates across asynchronous executions. `localStorage` gracefully falls back as a no-op instead of throwing exceptions.

The `xfetch/vue` and `xfetch/react` libraries implement logic specifically accounting for SSR hydration:
- Caching deduplicates double-requests across initial hydration.
- The standard behavior of rendering components respects Next's app router data fetching without issues.
