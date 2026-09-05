import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';
import { guardStripPlugin } from '../guard-strip.js';

type TransformFn = (
  code: string,
  id: string,
  options?: { ssr?: boolean }
) => { code: string; map: unknown } | undefined;

// Same harness shape as `guard-strip-plugin.test.ts`: call the plugin's
// `transform` directly. Returns the emitted code, or the input unchanged when
// the plugin declines to transform.
function transformWith(
  code: string,
  id: string,
  options: { ssr?: boolean; root?: string | null } = {}
): string {
  const plugin = guardStripPlugin() as Plugin & {
    transform: TransformFn;
    configResolved: (config: { root: string }) => void;
  };
  const { ssr, root = '/' } = options;
  if (root !== null) plugin.configResolved.call({} as never, { root });
  const result = plugin.transform.call(
    {} as never,
    code,
    id,
    ssr ? { ssr } : {}
  );
  return result?.code ?? code;
}

describe('channel id injection', () => {
  it('injects a module-derived id at the call site', () => {
    const out = transformWith(
      `import { defineSessionChannel } from 'hono-preact';
       const a = defineSessionChannel();`,
      '/src/demo/guard.ts'
    );
    expect(out).toContain('defineSessionChannel("src/demo/guard.ts#0")');
  });

  it('numbers multiple channels in one module by declaration order', () => {
    const out = transformWith(
      `import { defineSessionChannel } from 'hono-preact';
       const a = defineSessionChannel();
       const b = defineSessionChannel();`,
      '/src/demo/guard.ts'
    );
    expect(out).toContain('"src/demo/guard.ts#0"');
    expect(out).toContain('"src/demo/guard.ts#1"');
  });

  it('produces the same id in the server and client bundles', () => {
    const src = `import { defineSessionChannel } from 'hono-preact';
                 const a = defineSessionChannel();`;
    const server = transformWith(src, '/src/demo/guard.ts', { ssr: true });
    const client = transformWith(src, '/src/demo/guard.ts', { ssr: false });
    const id = /defineSessionChannel\("([^"]+)"\)/;
    expect(src.match(id)).toBeNull();
    expect(server.match(id)?.[1]).toBe(client.match(id)?.[1]);
    expect(server.match(id)?.[1]).toBe('src/demo/guard.ts#0');
  });

  it('strips a query suffix so both bundles agree on the id', () => {
    const src = `import { defineSessionChannel } from 'hono-preact';
                 const a = defineSessionChannel();`;
    const out = transformWith(src, '/src/demo/guard.ts?v=abc123');
    expect(out).toContain('defineSessionChannel("src/demo/guard.ts#0")');
  });

  it('handles a renamed import', () => {
    const out = transformWith(
      `import { defineSessionChannel as c } from '@hono-preact/iso';
       const a = c();`,
      '/src/demo/guard.ts'
    );
    expect(out).toContain('c("src/demo/guard.ts#0")');
  });

  it('handles a namespace import', () => {
    const out = transformWith(
      `import * as hp from 'hono-preact';
       const a = hp.defineSessionChannel();`,
      '/src/demo/guard.ts'
    );
    expect(out).toContain('hp.defineSessionChannel("src/demo/guard.ts#0")');
  });

  it('leaves a call that already has an explicit id alone', () => {
    const out = transformWith(
      `import { defineSessionChannel } from 'hono-preact';
       const a = defineSessionChannel('mine');`,
      '/src/demo/guard.ts'
    );
    expect(out).toContain(`defineSessionChannel('mine')`);
    expect(out).not.toContain('src/demo/guard.ts#0');
  });

  it('leaves a same-named function from another package alone', () => {
    const out = transformWith(
      `import { defineSessionChannel } from 'some-other-lib';
       const a = defineSessionChannel();`,
      '/src/demo/guard.ts'
    );
    expect(out).not.toContain('src/demo/guard.ts#0');
  });

  it('does not disturb the existing middleware strips in the same module', () => {
    const out = transformWith(
      `import { defineSessionChannel, defineServerMiddleware } from 'hono-preact';
       const a = defineSessionChannel();
       const m = defineServerMiddleware(async (ctx, next) => { await next(); });`,
      '/src/demo/guard.ts',
      { ssr: false }
    );
    expect(out).toContain('"src/demo/guard.ts#0"');
    expect(out).toContain("runs: 'server'");
  });

  it('injects a root-relative id carrying no absolute build path', () => {
    const root = '/Users/someone/repos/app';
    const out = transformWith(
      `import { defineSessionChannel } from 'hono-preact';
       const a = defineSessionChannel();`,
      `${root}/apps/site/src/demo/guard.ts`,
      { root }
    );
    expect(out).toContain(
      'defineSessionChannel("apps/site/src/demo/guard.ts#0")'
    );
    expect(out).not.toContain(root);
    expect(out).not.toContain('"/');
  });

  it('gives a module outside the root a stable non-absolute id', () => {
    const src = `import { defineSessionChannel } from 'hono-preact';
                 const a = defineSessionChannel();`;
    const id = '/elsewhere/pkg/node_modules/vendor/dist/guard.js';
    const first = transformWith(src, id, { root: '/Users/someone/repos/app' });
    const second = transformWith(src, id, { root: '/Users/someone/repos/app' });
    expect(first).toContain(
      'defineSessionChannel("node_modules/vendor/dist/guard.js#0")'
    );
    expect(second).toBe(first);
  });

  it('normalizes windows separators so the id is platform independent', () => {
    const out = transformWith(
      `import { defineSessionChannel } from 'hono-preact';
       const a = defineSessionChannel();`,
      'C:\\repos\\app\\src\\demo\\guard.ts',
      { root: 'C:\\repos\\app' }
    );
    expect(out).toContain('defineSessionChannel("src/demo/guard.ts#0")');
    expect(out).not.toContain('\\\\');
  });

  // The whole reason a compile-time id exists: the client bundle strips the
  // server middleware body while the server bundle keeps it, so any counting
  // that skipped stripped subtrees would hand the two bundles different indices
  // for the SAME top-level channel. This is the design's stated main risk.
  it('agrees across bundles when an earlier channel is nested inside a strip', () => {
    const src = `import { defineSessionChannel, defineServerMiddleware } from 'hono-preact';
                 const mw = defineServerMiddleware(async (ctx, next) => {
                   const inner = defineSessionChannel();
                   await next();
                 });
                 const top = defineSessionChannel();`;
    const root = '/Users/someone/repos/app';
    const id = `${root}/src/demo/guard.ts`;
    const server = transformWith(src, id, { ssr: true, root });
    const client = transformWith(src, id, { ssr: false, root });

    // The client bundle strips the middleware body, so only the top-level call
    // survives there; the server bundle keeps both.
    expect(client).toContain("runs: 'server'");
    expect(client).not.toContain('src/demo/guard.ts#0');
    expect(client).toContain('defineSessionChannel("src/demo/guard.ts#1")');
    expect(server).toContain('defineSessionChannel("src/demo/guard.ts#1")');
  });
});
