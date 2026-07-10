import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { collectImports, collectCasts } from './agents-conformance-checker.js';

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

  it('collectCasts reports only the outermost cast of an as-chain', () => {
    // `x as unknown as Foo` is a single chained cast; the inner `x as unknown`
    // is just the `.expression` of the outer and must not appear as a separate
    // entry. But `(x as T).foo as U` is two independent casts and both should
    // be reported.
    const chain = collectCasts('const a = x as unknown as Foo;', false);
    expect(chain).toHaveLength(1);
    expect(chain[0].expr).toBe('x as unknown as Foo');

    const independent = collectCasts('const b = (x as T).foo as U;', false);
    expect(independent).toHaveLength(2);
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

  // Genuine type-cast boundaries. Each entry is keyed by repo-relative file
  // path plus the exact (whitespace-collapsed) cast expression, and carries a
  // one-line reason. Prefer reshaping the type over adding an entry here.
  const CAST_ALLOWLIST: { file: string; expr: string; reason: string }[] = [
    {
      file: 'demo/session.ts',
      expr: 'JSON.parse(raw) as CookiePayload',
      reason: 'parsing an untrusted cookie payload (acceptable boundary)',
    },
    {
      file: 'hooks/use-board-drag.ts',
      expr: 'card.cloneNode(true) as HTMLElement',
      reason: 'Node.cloneNode returns Node; the source is an HTMLElement',
    },
    {
      file: 'hooks/use-board-drag.ts',
      expr: 'e.currentTarget as HTMLElement',
      reason: 'DOM event currentTarget is EventTarget | null at the type level',
    },
    {
      file: 'components/HeroShader.tsx',
      expr: 'e.data as WorkerOutMsg',
      reason: 'Worker MessageEvent.data is any (untyped postMessage boundary)',
    },
    {
      file: 'components/shader-worker.ts',
      expr: 'e.data as WorkerInMsg',
      reason: 'Worker MessageEvent.data is any (untyped postMessage boundary)',
    },
    {
      file: 'components/demo/TaskCard.tsx',
      expr: 'e as PointerEvent',
      reason:
        'bridging the Preact pointer-handler event to the DOM PointerEvent',
    },
    {
      file: 'components/shader-worker.ts',
      expr: 'self as unknown as { postMessage(message: WorkerOutMsg): void }',
      reason:
        'worker global: the DOM lib types self as Window, whose postMessage signature differs from a worker; narrow the one method we call',
    },
  ];

  it('R5: no casts outside the allowlist', () => {
    const allowed = new Set(CAST_ALLOWLIST.map((e) => `${e.file}|${e.expr}`));
    const seen = new Set<string>();
    const violations: string[] = [];
    for (const f of files) {
      const rel = relativeToSiteSrc(f);
      const tsx = f.endsWith('.tsx');
      for (const { expr } of collectCasts(readFileSync(f, 'utf8'), tsx)) {
        const key = `${rel}|${expr}`;
        seen.add(key);
        if (!allowed.has(key)) {
          violations.push(`${rel}: ${expr}`);
        }
      }
    }
    expect(
      violations,
      `Reshape the type (predicate, typed binding, generic value) or add an ` +
        `allowlist entry with a reason:\n${violations.join('\n')}`
    ).toEqual([]);

    // Honesty: every allowlist entry must still correspond to a real cast.
    const stale = [...allowed].filter((k) => !seen.has(k));
    expect(
      stale,
      `Remove stale allowlist entries:\n${stale.join('\n')}`
    ).toEqual([]);
  });
});
