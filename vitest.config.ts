import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const src = (p: string) => resolve(__dirname, 'src', p);

// Explicit module path aliases — map each '.js' import to its '.ts' source.
// Vitest's resolve.alias processes these before module loading, so this works
// even in forks/vmForks pool mode.
const jsToTsAliases = [
  'core/client',
  'core/interceptors',
  'core/request',
  'features/auth',
  'features/cache',
  'features/retry',
  'utils/types',
  'utils/helpers',
].flatMap((mod) => [
  // Match from test files (../../xxx) and from source files (../xxx etc.)
  { find: `../${mod}.js`,  replacement: src(`${mod}.ts`) },
  { find: `../../${mod}.js`, replacement: src(`${mod}.ts`) },
  { find: `../../../${mod}.js`, replacement: src(`${mod}.ts`) },
]);

export default defineConfig({
  resolve: {
    alias: jsToTsAliases,
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/adapters/**',
        'src/index.ts',
        'src/plugins/**',
      ],
      thresholds: {
        lines: 75,
        functions: 80,
        branches: 70,
      },
    },
  },
});
