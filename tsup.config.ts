import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };
const banner = `/* XFetch v${version} | Universal HTTP Fetching Library | MIT License | https://github.com/your-org/xfetch */`;

export default defineConfig([
  // ── Main library (ESM + CJS + TypeScript declarations) ───────────────────
  {
    entry: {
      index:           'src/index.ts',
      'adapters/react': 'src/adapters/react.ts',
      'adapters/vue':  'src/adapters/vue.ts',
    },
    format:    ['esm', 'cjs'],
    dts:       true,
    sourcemap: true,
    clean:     true,
    treeshake: true,
    splitting: false,
    minify:    true,
    // Framework peers must NOT be bundled
    external:  ['react', 'vue'],
    esbuildOptions(options) {
      options.banner = { js: banner };
    },
  },

  // ── UMD / browser bundle — self-contained, minified, CDN-ready ───────────
  {
    entry:       { xfetch: 'src/index.ts' },
    format:      ['iife'],
    globalName:  'XFetch',
    outExtension: () => ({ js: '.umd.js' }),
    sourcemap:   true,
    minify:      true,
    external:    [], // everything bundled in
    esbuildOptions(options) {
      options.banner = { js: banner };
    },
  },
]);
