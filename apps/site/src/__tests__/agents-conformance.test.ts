import { describe, it, expect } from 'vitest';
import {
  collectImports,
  collectCasts,
} from './agents-conformance-checker.js';

describe('conformance checker (self-test)', () => {
  it('collectImports finds static, re-export, and dynamic specifiers', () => {
    const src = `
      import { useState } from 'preact/hooks';
      import x from 'react';
      export { y } from '@hono-preact/iso';
      const m = await import('hono-preact/internal');
    `;
    const specs = collectImports(src, false);
    expect(specs).toContain('preact/hooks');
    expect(specs).toContain('react');
    expect(specs).toContain('@hono-preact/iso');
    expect(specs).toContain('hono-preact/internal');
  });

  it('collectCasts finds as-expressions and angle-bracket assertions', () => {
    const src = `
      const a = foo as Bar;
      const b = <Baz>qux;
      const c = e.data as WorkerOutMsg;
    `;
    const casts = collectCasts(src, false).map((c) => c.expr);
    expect(casts).toContain('foo as Bar');
    expect(casts).toContain('e.data as WorkerOutMsg');
    expect(casts.some((c) => c.includes('Baz'))).toBe(true);
  });

  it('collectCasts ignores `as const`', () => {
    const casts = collectCasts(`const a = [1, 2] as const;`, false);
    expect(casts).toHaveLength(0);
  });

  it('collectCasts handles tsx and ignores generic calls / import aliases', () => {
    const src = `
      import { Map as MapIcon } from 'lucide-preact';
      const r = useRef<HTMLDivElement>(null);
      const v = (x) => x;
    `;
    expect(collectCasts(src, true)).toHaveLength(0);
  });
});
