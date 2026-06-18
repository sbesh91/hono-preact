import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const here = dirname(fileURLToPath(import.meta.url));
const siteSrc = resolve(here, '..'); // apps/site/src

function appCodeFiles(): string[] {
  const files: string[] = [];
  const walkDir = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walkDir(resolve(dir, entry.name));
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(resolve(dir, entry.name));
      }
    }
  };
  walkDir(siteSrc);
  return files;
}

const relativeToSiteSrc = (abs: string) =>
  relative(siteSrc, abs).split('\\').join('/');

describe('AGENTS.md conformance (live apps/site)', () => {
  const files = appCodeFiles();

  it('R1: no react / react-dom imports', () => {
    const violations: string[] = [];
    for (const f of files) {
      const tsx = f.endsWith('.tsx');
      for (const spec of collectImports(readFileSync(f, 'utf8'), tsx)) {
        if (/^react(-dom)?(\/|$)/.test(spec)) {
          violations.push(`${relativeToSiteSrc(f)}: imports '${spec}'`);
        }
      }
    }
    expect(
      violations,
      `Use preact/hooks and preact, not react:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('R2: framework imports stay on the public surface', () => {
    const violations: string[] = [];
    for (const f of files) {
      const tsx = f.endsWith('.tsx');
      for (const spec of collectImports(readFileSync(f, 'utf8'), tsx)) {
        if (spec.includes('/internal') || spec.startsWith('@hono-preact/')) {
          violations.push(`${relativeToSiteSrc(f)}: imports '${spec}'`);
        }
      }
    }
    expect(
      violations,
      `Import from the public surface (hono-preact, hono-preact/page, ` +
        `hono-preact/server, hono-preact-ui), not internals:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
