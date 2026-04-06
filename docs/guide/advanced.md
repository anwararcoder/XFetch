# Advanced Usage

XFetch is more than just a wrapper over fetch. It abstracts the heavy lifting caching, retry logic, and interceptors cleanly.

## Retry Architectures

In modern applications, networks drop. Retry handles transient errors seamlessly without polluting your business logic.

```typescript
const api = createClient({
  retry: {
    count: 5,
    delay: 1000,
  }
})
```

## Plugin System

The plugin system allows injecting reusable behavior directly into the request cycle by interacting with interceptors behind the scenes.

```typescript
import { createLoggerPlugin } from '@ar-coder/xfetch';

api.use(createLoggerPlugin({ logBody: true }));
```
