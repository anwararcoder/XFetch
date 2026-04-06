# Vue Integration

XFetch exports reactive composables for Vue 3 via `xfetch/vue`.

## `useApi`

Fetches data reactively and updates Vue `ref()` instances.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { createClient } from 'xfetch';
import { useApi } from 'xfetch/vue';

const api = createClient({ baseURL: '/api' });
const { data, loading, error, execute } = useApi<User[]>(api, '/users');
</script>

<template>
  <div v-if="loading">Loading...</div>
  <div v-else-if="error">{{ error.message }}</div>
  <div v-else>{{ data?.name }}</div>
</template>
```

### Options

- `lazy` (boolean): If `true`, the request must be triggered manually via `execute()`.
- `watchSources` (array): Vue refs to watch; triggers fetch automatically on changes.

## `useApiMutation`

Handles declarative writes without fetching on mount.

```vue
<script setup lang="ts">
import { useApiMutation } from 'xfetch/vue';

const { mutate, loading } = useApiMutation<Item, { text: string }>(api, 'post', '/items');
</script>

<template>
  <button :disabled="loading" @click="mutate({ text: 'Hello' })">
    Add Item
  </button>
</template>
```
