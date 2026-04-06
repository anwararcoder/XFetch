# Getting Started

## Introduction

XFetch is a highly extensible, framework-agnostic HTTP fetching client modeled after Axios but built entirely around modern `fetch`. It's designed to run perfectly anywhere JavaScript does: React apps, backend Node services, Nuxt SSR, or a plain script tag.

## Installation

```bash
npm install @ar-coder/xfetch
```

## Creating a Client

```typescript
import { createClient } from '@ar-coder/xfetch';

const api = createClient({
  baseURL: 'https://api.example.com',
  headers: {
    'Accept': 'application/json'
  }
});

// Easily execute requests
const { data, status } = await api.get('/users');
console.log(data);
```
