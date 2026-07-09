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

  it('strips a namespace-import member call (server-code leak defense)', () => {
    // Regression: `import * as hp` + `hp.defineServerMiddleware(...)` produces no
    // named binding, so a local-name-only matcher never fired and the auth/
    // session body shipped to the client. guard-strip is the ONLY protection for
    // route-level middleware (a .server.* module cannot export middleware), so
    // the member-call form must be matched too.
    const code = `
      import * as hp from 'hono-preact';
      export const mw = hp.defineServerMiddleware(async (_c, next) => {
        await verifySessionSecret();
        await next();
      });
    `;
    const result = transform(code, '/src/routes.tsx');
    expect(result?.code).toMatch(/__kind:\s*['"]middleware['"]/);
    expect(result?.code).toMatch(/runs:\s*['"]server['"]/);
    expect(result?.code).not.toMatch(/hp\.defineServerMiddleware\s*\(/);
    expect(result?.code).not.toContain('verifySessionSecret');
  });

  it('strips a namespace-import member call from the scoped iso source too', () => {
    const code = `
      import * as iso from '@hono-preact/iso';
      export const mw = iso.defineServerMiddleware(async (_c, next) => {
        await secretServerCall();
        await next();
      });
    `;
    const result = transform(code, '/src/routes.tsx');
    expect(result?.code).toMatch(/__kind:\s*['"]middleware['"]/);
    expect(result?.code).not.toContain('secretServerCall');
  });

  it('leaves a namespace member call to a non-framework namespace alone', () => {
    // `other.defineServerMiddleware` where `other` is not a framework namespace
    // must not be rewritten (no false positive on an unrelated import).
    const code = `
      import * as other from './helpers.js';
      export const x = other.defineServerMiddleware(1);
    `;
    // No framework symbol is even mentioned via a framework import, so the
    // pre-filter would still see the string; assert the call survives untouched.
    const result = transform(code, '/src/routes.tsx');
    expect(result).toBeUndefined();
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
