// ─────────────────────────────────────────────────────────────────────────────
// XFetch — React + Next.js Example
//
// Demonstrates:
//   1. useRequest() hook for data fetching
//   2. useMutation() hook for write operations
//   3. SSR-compatible (getServerSideProps) fetch
//   4. React Query compatible queryFn pattern
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { createClient } from 'xfetch';
import { useRequest, useMutation } from 'xfetch/react';

// ── 1. Create a shared API client (module-level singleton) ───────────────────
export const api = createClient({
  baseURL: process.env['NEXT_PUBLIC_API_URL'] ?? 'https://jsonplaceholder.typicode.com',
  timeout: 10_000,
  retry: { count: 3, delay: 500 },
  auth: {
    // Token injected automatically on every request
    token: typeof window !== 'undefined' ? localStorage.getItem('token') ?? undefined : undefined,
    // Called on 401 — exchanges refresh token for a new access token
    refreshToken: async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      const json = await res.json() as { token?: string };
      return json.token ?? null;
    },
  },
});

// Register the logger plugin in development
if (process.env['NODE_ENV'] !== 'production') {
  const { createLoggerPlugin } = await import('xfetch');
  api.use(createLoggerPlugin({ logBody: true }));
}

// ── 2. Types ──────────────────────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
}

interface CreateUserInput {
  name: string;
  email: string;
}

// ── 3. useRequest hook example ────────────────────────────────────────────────

export function UserList() {
  const { data, loading, error, execute } = useRequest<User[]>(api, '/users', {
    cache: { storage: 'memory', ttl: 5 * 60 * 1000 }, // 5-minute cache
    onSuccess: (users) => console.log(`Loaded ${users.length} users`),
    onError: (err) => console.error('Failed to load users:', err.message),
  });

  if (loading) return <p>Loading users…</p>;
  if (error)   return <p>Error: {error.message} <button onClick={() => void execute()}>Retry</button></p>;
  if (!data)   return null;

  return (
    <ul>
      {data.map((user) => (
        <li key={user.id}>{user.name} — {user.email}</li>
      ))}
    </ul>
  );
}

// ── 4. Lazy mode + manual trigger ─────────────────────────────────────────────

export function UserSearchButton() {
  const { data, loading, error, execute } = useRequest<User[]>(api, '/users', {
    lazy: true, // Don't auto-fetch on mount
    params: { _limit: 5 },
  });

  return (
    <div>
      <button onClick={() => void execute()} disabled={loading}>
        {loading ? 'Loading…' : 'Search Users'}
      </button>
      {error && <p style={{ color: 'red' }}>{error.message}</p>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}

// ── 5. useMutation example ────────────────────────────────────────────────────

export function CreateUserForm() {
  const { mutate, loading, error, data } = useMutation<User, CreateUserInput>(
    api, 'post', '/users'
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await mutate({
      name: form.get('name') as string,
      email: form.get('email') as string,
    });
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <input name="name" placeholder="Name" required />
      <input name="email" type="email" placeholder="Email" required />
      <button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create User'}
      </button>
      {error && <p style={{ color: 'red' }}>{error.message}</p>}
      {data && <p style={{ color: 'green' }}>Created: {data.name}</p>}
    </form>
  );
}

// ── 6. React Query compatibility ─────────────────────────────────────────────
//
// XFetch works perfectly as a React Query queryFn:
//
// import { useQuery, useMutation as useRQMutation } from '@tanstack/react-query';
//
// function UsersWithReactQuery() {
//   const { data, isLoading } = useQuery({
//     queryKey: ['users'],
//     queryFn: () => api.get<User[]>('/users').then(r => r.data),
//     staleTime: 5 * 60 * 1000,
//   });
//   return isLoading ? <p>Loading…</p> : <ul>{data?.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
// }

// ── 7. Next.js SSR (getServerSideProps) ───────────────────────────────────────
//
// import type { GetServerSideProps } from 'next';
//
// // This runs ONLY on the server — XFetch uses Node 18's native fetch
// export const getServerSideProps: GetServerSideProps = async (ctx) => {
//   const serverApi = createClient({
//     baseURL: process.env.INTERNAL_API_URL,  // internal service URL for SSR
//     headers: {
//       // Forward auth cookies from the browser request
//       cookie: ctx.req.headers.cookie ?? '',
//     },
//   });
//
//   try {
//     const { data } = await serverApi.get<User[]>('/users');
//     return { props: { users: data } };
//   } catch {
//     return { props: { users: [] } };
//   }
// };
//
// export default function SSRPage({ users }: { users: User[] }) {
//   return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
// }
