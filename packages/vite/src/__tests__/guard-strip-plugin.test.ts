import { describe, it, expect } from 'vitest';
import { guardStripPlugin } from '../guard-strip.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string,
  options?: { ssr?: boolean }
) => { code: string; map: unknown } | undefined;

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean } = {}
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
      "import { __$guardNoop_hpiso } from 'hono-preact/internal';"
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
    expect(result).toBeUndefined();
  });
});

describe('guardStripPlugin: server pass (ssr=true)', () => {
  it('replaces defineClientGuard call arg with the noop import', () => {
    const code = `
      import { defineClientGuard } from '@hono-preact/iso';
      const g = defineClientGuard(async (ctx, next) => {
        await fetchFromBrowser();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx', { ssr: true });
    expect(result?.code).toContain(
      "import { __$guardNoop_hpiso } from 'hono-preact/internal';"
    );
    expect(result?.code).toContain('defineClientGuard(__$guardNoop_hpiso)');
    expect(result?.code).not.toContain('await fetchFromBrowser()');
  });

  it('does not touch defineServerGuard calls in server pass', () => {
    const code = `
      import { defineServerGuard } from '@hono-preact/iso';
      const g = defineServerGuard(async (ctx, next) => {
        await onServer();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx', { ssr: true });
    expect(result).toBeUndefined();
  });
});

describe('guardStripPlugin: aliasing', () => {
  it('handles import alias for defineServerGuard', () => {
    const code = `
      import { defineServerGuard as dsg } from '@hono-preact/iso';
      const g = dsg(async (ctx, next) => {
        await secret();
        return next();
      });
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code).toContain('dsg(__$guardNoop_hpiso)');
    expect(result?.code).not.toContain('await secret()');
  });

  it('handles import from the umbrella hono-preact source', () => {
    const code = `
      import { defineServerGuard } from 'hono-preact';
      const g = defineServerGuard(async () => undefined);
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code).toContain('defineServerGuard(__$guardNoop_hpiso)');
  });

  it('rewrites a call whose argument is a named function reference', () => {
    const code = `
      import { defineServerGuard } from '@hono-preact/iso';
      async function checkAdmin(ctx, next) { await db(); return next(); }
      const g = defineServerGuard(checkAdmin);
    `;
    const result = transform(code, '/src/pages/admin.tsx');
    expect(result?.code).toContain('defineServerGuard(__$guardNoop_hpiso)');
  });
});

describe('guardStripPlugin extends to middleware/observer helpers', () => {
  it('rewrites defineServerMiddleware in the client bundle to a no-op brand object', () => {
    const code = `
      import { defineServerMiddleware } from '@hono-preact/iso';
      export const mw = defineServerMiddleware(async (_c, next) => {
        await secretServerCall();
        await next();
      });
    `;
    const result = transform(code, '/src/pages/home.tsx');
    expect(result?.code).toMatch(/__kind:\s*['"]middleware['"]/);
    expect(result?.code).toMatch(/runs:\s*['"]server['"]/);
    expect(result?.code).not.toMatch(/defineServerMiddleware\s*\(/);
    // The user's middleware body is gone; only the brand object remains.
    expect(result?.code).not.toContain('secretServerCall');
    // Whole-call replacement means no noop import is needed.
    expect(result?.code).not.toContain('__$guardNoop_hpiso');
  });

  it('rewrites defineClientMiddleware in the server bundle to a no-op brand object', () => {
    const code = `
      import { defineClientMiddleware } from '@hono-preact/iso';
      export const mw = defineClientMiddleware(async (_c, next) => {
        await onBrowser();
        await next();
      });
    `;
    const result = transform(code, '/src/pages/home.tsx', { ssr: true });
    expect(result?.code).toMatch(/runs:\s*['"]client['"]/);
    expect(result?.code).not.toMatch(/defineClientMiddleware\s*\(/);
    expect(result?.code).not.toContain('onBrowser');
  });

  it('rewrites defineStreamObserver in the client bundle to a no-op observer record', () => {
    const code = `
      import { defineStreamObserver } from '@hono-preact/iso';
      export const obs = defineStreamObserver({
        onChunk: () => callServerOnlyLogger(),
      });
    `;
    const result = transform(code, '/src/pages/home.tsx');
    expect(result?.code).toMatch(/__kind:\s*['"]observer['"]/);
    expect(result?.code).not.toMatch(/defineStreamObserver\s*\(/);
    expect(result?.code).not.toContain('callServerOnlyLogger');
  });

  it('leaves defineServerMiddleware untouched in the server bundle', () => {
    const code = `
      import { defineServerMiddleware } from '@hono-preact/iso';
      export const mw = defineServerMiddleware(async (_c, next) => next());
    `;
    expect(
      transform(code, '/src/pages/home.tsx', { ssr: true })
    ).toBeUndefined();
  });

  it('leaves defineClientMiddleware untouched in the client bundle', () => {
    const code = `
      import { defineClientMiddleware } from '@hono-preact/iso';
      export const mw = defineClientMiddleware(async (_c, next) => next());
    `;
    expect(transform(code, '/src/pages/home.tsx')).toBeUndefined();
  });

  it('leaves defineStreamObserver untouched in the server bundle', () => {
    const code = `
      import { defineStreamObserver } from '@hono-preact/iso';
      export const obs = defineStreamObserver({ onChunk: () => {} });
    `;
    expect(
      transform(code, '/src/pages/home.tsx', { ssr: true })
    ).toBeUndefined();
  });

  it('handles import aliases for the new symbols', () => {
    const code = `
      import { defineServerMiddleware as dsmw } from '@hono-preact/iso';
      export const mw = dsmw(async () => undefined);
    `;
    const result = transform(code, '/src/pages/home.tsx');
    expect(result?.code).toMatch(/__kind:\s*['"]middleware['"]/);
    expect(result?.code).not.toContain('dsmw(');
  });

  it('mixes arg-noop (guard) and whole-call (middleware) rewrites in one file without spurious noop import duplication', () => {
    const code = `
      import { defineServerGuard, defineServerMiddleware } from '@hono-preact/iso';
      export const g = defineServerGuard(async (ctx, next) => next());
      export const mw = defineServerMiddleware(async (_c, next) => next());
    `;
    const result = transform(code, '/src/pages/home.tsx');
    // Guard gets arg-noop; middleware gets whole-call replacement.
    expect(result?.code).toContain('defineServerGuard(__$guardNoop_hpiso)');
    expect(result?.code).toMatch(/__kind:\s*['"]middleware['"]/);
    // Only ONE noop import even though both rewrites happen.
    const importMatches = result?.code.match(
      /import \{ __\$guardNoop_hpiso \} from 'hono-preact\/internal';/g
    );
    expect(importMatches).toHaveLength(1);
  });
});

describe('guardStripPlugin: leaves unaffected code alone', () => {
  it('returns undefined when no defineServerGuard or defineClientGuard is imported', () => {
    const code = `import { Something } from './x.js'; const y = Something();`;
    expect(transform(code, '/src/x.tsx')).toBeUndefined();
    expect(transform(code, '/src/x.tsx', { ssr: true })).toBeUndefined();
  });

  it('returns undefined when defineServerGuard is imported but unused in this file', () => {
    const code = `import { defineServerGuard } from '@hono-preact/iso';`;
    const result = transform(code, '/src/x.tsx');
    expect(result).toBeUndefined();
  });

  it('does not transform .server.* files themselves', () => {
    const code = `
      import { defineServerGuard } from '@hono-preact/iso';
      export const x = defineServerGuard(async () => undefined);
    `;
    expect(transform(code, '/src/pages/admin.server.ts')).toBeUndefined();
  });
});
