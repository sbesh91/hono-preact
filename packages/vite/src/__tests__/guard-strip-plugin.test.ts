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

describe('guardStripPlugin: middleware/observer rewrites', () => {
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
    expect(result?.code).not.toContain('secretServerCall');
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

  it('handles import from the umbrella hono-preact source', () => {
    const code = `
      import { defineServerMiddleware } from 'hono-preact';
      export const mw = defineServerMiddleware(async (_c, next) => next());
    `;
    const result = transform(code, '/src/pages/home.tsx');
    expect(result?.code).toMatch(/__kind:\s*['"]middleware['"]/);
  });
});

describe('guardStripPlugin: leaves unaffected code alone', () => {
  it('returns undefined when no recognized symbol is imported', () => {
    const code = `import { Something } from './x.js'; const y = Something();`;
    expect(transform(code, '/src/x.tsx')).toBeUndefined();
    expect(transform(code, '/src/x.tsx', { ssr: true })).toBeUndefined();
  });

  it('returns undefined when defineServerMiddleware is imported but unused', () => {
    const code = `import { defineServerMiddleware } from '@hono-preact/iso';`;
    const result = transform(code, '/src/x.tsx');
    expect(result).toBeUndefined();
  });

  it('does not transform .server.* files themselves', () => {
    const code = `
      import { defineServerMiddleware } from '@hono-preact/iso';
      export const mw = defineServerMiddleware(async () => undefined);
    `;
    expect(transform(code, '/src/pages/admin.server.ts')).toBeUndefined();
  });
});
