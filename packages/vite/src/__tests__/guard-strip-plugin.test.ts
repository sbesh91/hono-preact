import { describe, it, expect } from 'vitest';
import { guardStripPlugin } from '../guard-strip.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => { code: string; map: unknown } | undefined;

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean } = {},
): { code: string; map: unknown } | undefined {
  const plugin = guardStripPlugin() as Plugin & { transform: TransformFn };
  const { ssr } = options;
  return plugin.transform.call({} as any, code, id, ssr ? { ssr } : {});
}

describe('guardStripPlugin: client pass (non-ssr)', () => {
  it('replaces defineServerGuard call arg with the noop import', () => {
    const code = `
      import { defineServerGuard } from '@hono-preact/iso';
      const g = defineServerGuard(async (ctx, next) => {
        const x = await secret();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code).toContain(
      "import { __$guardNoop_hpiso } from '@hono-preact/iso/internal';",
    );
    expect(result?.code).toContain('defineServerGuard(__$guardNoop_hpiso)');
    expect(result?.code).not.toContain('await secret()');
  });

  it('does not touch defineClientGuard calls in client pass', () => {
    const code = `
      import { defineClientGuard } from '@hono-preact/iso';
      const g = defineClientGuard(async (ctx, next) => {
        await onClient();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code ?? code).toContain('await onClient()');
  });
});
