// ─────────────────────────────────────────────────────────────────────────────
// interceptors.test.ts — Unit tests for src/core/interceptors.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { InterceptorManager } from '../../core/interceptors.js';
import { XFetchError } from '../../utils/types.js';

describe('InterceptorManager', () => {
  // ── use / eject ────────────────────────────────────────────────────────────

  it('starts empty', () => {
    const mgr = new InterceptorManager<string>();
    expect(mgr.size).toBe(0);
  });

  it('registers an interceptor and returns a handle', () => {
    const mgr = new InterceptorManager<string>();
    const handle = mgr.use((v) => v.toUpperCase());
    expect(handle).toHaveProperty('id');
    expect(mgr.size).toBe(1);
  });

  it('ejects an interceptor by id', () => {
    const mgr = new InterceptorManager<string>();
    const handle = mgr.use((v) => v + '!');
    expect(mgr.size).toBe(1);
    mgr.eject(handle.id);
    expect(mgr.size).toBe(0);
  });

  it('does not error when ejecting non-existent id', () => {
    const mgr = new InterceptorManager<string>();
    expect(() => mgr.eject(999)).not.toThrow();
  });

  it('clear() removes all interceptors', () => {
    const mgr = new InterceptorManager<string>();
    mgr.use((v) => v);
    mgr.use((v) => v);
    mgr.clear();
    expect(mgr.size).toBe(0);
  });

  // ── run / ordering ─────────────────────────────────────────────────────────

  it('runs the initial value through no interceptors unchanged', async () => {
    const mgr = new InterceptorManager<number>();
    const result = await mgr.run(42);
    expect(result).toBe(42);
  });

  it('applies a single interceptor', async () => {
    const mgr = new InterceptorManager<number>();
    mgr.use((n) => n * 2);
    expect(await mgr.run(3)).toBe(6);
  });

  it('chains multiple interceptors in insertion order', async () => {
    const mgr = new InterceptorManager<number>();
    mgr.use((n) => n + 1);  // 1 + 1 = 2
    mgr.use((n) => n * 3);  // 2 * 3 = 6
    expect(await mgr.run(1)).toBe(6);
  });

  it('supports async interceptors', async () => {
    const mgr = new InterceptorManager<string>();
    mgr.use(async (v) => `${v}_async`);
    expect(await mgr.run('hello')).toBe('hello_async');
  });

  it('skips ejected interceptors', async () => {
    const mgr = new InterceptorManager<number>();
    mgr.use((n) => n + 10);      // #0 — will eject
    const h = mgr.use((n) => n + 100); // #1 — will eject
    mgr.use((n) => n + 1);       // #2 — stays

    mgr.eject(h.id);

    // run: +10, (skip +100), +1 = 11
    expect(await mgr.run(0)).toBe(11);
  });

  // ── error handling ─────────────────────────────────────────────────────────

  it('re-throws when a fulfilled handler throws and no rejected handler', async () => {
    const mgr = new InterceptorManager<string>();
    mgr.use(() => { throw new Error('boom'); });
    await expect(mgr.run('x')).rejects.toThrow('boom');
  });

  it('calls the rejected handler when fulfilled throws', async () => {
    const mgr = new InterceptorManager<string>();
    const rejected = vi.fn((_err: XFetchError) => 'recovered');
    mgr.use(
      () => { throw new XFetchError({ message: 'fail' }); },
      rejected
    );
    const result = await mgr.run('input');
    expect(result).toBe('recovered');
    expect(rejected).toHaveBeenCalledOnce();
  });

  it('passes recovered value to the next interceptor', async () => {
    const mgr = new InterceptorManager<string>();
    mgr.use(
      () => { throw new XFetchError({ message: 'fail' }); },
      () => 'recovered'
    );
    mgr.use((v) => v + '!');
    expect(await mgr.run('start')).toBe('recovered!');
  });

  it('re-throws if rejected handler also throws', async () => {
    const mgr = new InterceptorManager<string>();
    mgr.use(
      () => { throw new XFetchError({ message: 'first' }); },
      () => { throw new XFetchError({ message: 'second' }); }
    );
    await expect(mgr.run('x')).rejects.toMatchObject({ message: 'second' });
  });

  // ── forEach ────────────────────────────────────────────────────────────────

  it('forEach visits only active interceptors', () => {
    const mgr = new InterceptorManager<string>();
    const h1 = mgr.use((v) => v);
    mgr.use((v) => v);
    mgr.eject(h1.id);

    const visited: number[] = [];
    mgr.forEach((h) => visited.push(h.id));
    expect(visited.length).toBe(1);
  });
});
