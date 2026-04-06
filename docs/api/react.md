# React Integration

XFetch provides native React hooks (`useRequest` and `useMutation`) imported from `xfetch/react`.

## `useRequest`

Fetches data and manages loading/error states. Suitable for data read operations. Re-executes intelligently if the dependency array or URL changes.

```tsx
import { createClient } from '@ar-coder/xfetch';
import { useRequest } from '@ar-coder/xfetch/react';

const api = createClient({ baseURL: '/api' });

function Profile() {
  const { data, loading, error, execute, cancel } = useRequest<User[]>(api, '/users');

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return <p>Hello {data?.name}</p>;
}
```

### Options

- `lazy` (boolean): Don't fetch on mount.
- `deps` (array): Re-run `execute()` when variables in the array change.
- `onSuccess` (function): Callback on successful fetch.
- `onError` (function): Callback on fetch error.

## `useMutation`

Designed specifically for imperative write actions (`POST`, `PUT`, `DELETE`). It doesn't run on mount.

```tsx
function AddItem() {
  const { mutate, loading } = useMutation<Item, { name: string }>(api, 'post', '/items');

  return (
    <button onClick={() => mutate({ name: 'New Item' })}>
      Submit
    </button>
  );
}
```
