<!-- ─────────────────────────────────────────────────────────────────────────
  XFetch — Vue 3 Example
  Demonstrates: useApi(), useApiMutation(), and Nuxt useAsyncData integration
─────────────────────────────────────────────────────────────────────────── -->
<template>
  <div>
    <h1>XFetch Vue Demo</h1>

    <!-- ── 1. Basic useApi ─────────────────────────────────────────────── -->
    <section>
      <h2>Users</h2>
      <p v-if="loading">Loading…</p>
      <p v-else-if="error" style="color:red">
        {{ error.message }}
        <button @click="execute">Retry</button>
      </p>
      <ul v-else>
        <li v-for="user in data" :key="user.id">
          {{ user.name }} — {{ user.email }}
        </li>
      </ul>
    </section>

    <!-- ── 2. Create user form ─────────────────────────────────────────── -->
    <section>
      <h2>Create User</h2>
      <form @submit.prevent="handleCreate">
        <input v-model="newName"  placeholder="Name"  required />
        <input v-model="newEmail" placeholder="Email" type="email" required />
        <button type="submit" :disabled="createLoading">
          {{ createLoading ? 'Creating…' : 'Create' }}
        </button>
      </form>
      <p v-if="createError" style="color:red">{{ createError.message }}</p>
      <p v-if="createData" style="color:green">Created: {{ createData.name }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { createClient } from 'xfetch';
import { useApi, useApiMutation } from 'xfetch/vue';

// ── Types ─────────────────────────────────────────────────────────────────────
interface User {
  id: number;
  name: string;
  email: string;
}

interface CreateUserInput {
  name: string;
  email: string;
}

// ── Shared client ─────────────────────────────────────────────────────────────
const api = createClient({
  baseURL: 'https://jsonplaceholder.typicode.com',
  timeout: 10_000,
  retry: { count: 2 },
  cache: { storage: 'memory', ttl: 5 * 60 * 1000 },
});

// ── 1. Data fetching with useApi ──────────────────────────────────────────────
const { data, loading, error, execute } = useApi<User[]>(api, '/users', {
  onSuccess: (users) => console.log(`Loaded ${users.length} users`),
  onError:   (err)   => console.error('API error:', err.message),
});

// ── 2. Mutation with useApiMutation ───────────────────────────────────────────
const {
  mutate: createUser,
  data: createData,
  loading: createLoading,
  error: createError,
} = useApiMutation<User, CreateUserInput>(api, 'post', '/users');

const newName  = ref('');
const newEmail = ref('');

async function handleCreate() {
  await createUser({ name: newName.value, email: newEmail.value });
  newName.value  = '';
  newEmail.value = '';
  // Optionally re-fetch the list
  await execute();
}

// ── 3. Interceptors (applied globally) ───────────────────────────────────────
api.interceptors.request.use((ctx) => {
  console.log('[interceptor] Request:', ctx.method, ctx.url);
  return ctx;
});
</script>

<!--
  ── NUXT INTEGRATION ────────────────────────────────────────────────────────

  In Nuxt 3 pages/components, use `useAsyncData` for SSR:

  <script setup lang="ts">
  import { createClient } from 'xfetch';

  const api = createClient({ baseURL: useRuntimeConfig().public.apiBase });

  // useAsyncData runs on BOTH server and client, XFetch handles both environments
  const { data, pending, error, refresh } = await useAsyncData(
    'users',           // unique key — Nuxt deduplicates on the server
    () => api.get<User[]>('/users').then(r => r.data),
    { server: true, lazy: false }
  );
  </script>

  // For lazy loading (CSR only):
  const { data, pending, error } = useLazyAsyncData('users',
    () => api.get<User[]>('/users').then(r => r.data)
  );

  // With $fetch (Nuxt's built-in) replacement pattern:
  // Simply swap $fetch(...) calls with api.get<T>(...).then(r => r.data)
-->
