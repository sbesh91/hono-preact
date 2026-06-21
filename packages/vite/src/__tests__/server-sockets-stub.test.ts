import { describe, it, expect } from 'vitest';
import { serverOnlyPlugin } from '../index.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string,
  options?: { ssr?: boolean }
) => { code: string; map: unknown } | undefined;

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean; root?: string } = {}
): { code: string; map: unknown } | undefined {
  const plugin = serverOnlyPlugin() as Plugin & {
    transform: TransformFn;
    configResolved?: (c: { root: string }) => void;
  };
  plugin.configResolved?.({ root: options.root ?? '/proj' });
  const { ssr } = options;
  return plugin.transform.call({} as any, code, id, ssr ? { ssr } : {});
}

describe('serverOnlyPlugin: serverSockets', () => {
  it('rewrites a client import of serverSockets into a descriptor proxy', () => {
    const code = `import { serverSockets } from '/proj/src/pages/chat.server.js';`;
    const out = transform(code, '/proj/src/app.tsx');
    expect(out?.code).toContain('new Proxy');
    expect(out?.code).toContain('__module');
    expect(out?.code).toContain('__socket');
  });

  it('stub carries the correct module key from the import source path', () => {
    const code = `import { serverSockets } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx');
    expect(out?.code).toContain('"src/pages/chat"');
  });

  it('uses the local binding name in the stub declaration', () => {
    const code = `import { serverSockets as sockets } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx');
    expect(out?.code).toContain('const sockets = new Proxy(');
    expect(out?.code).not.toContain('const serverSockets = new Proxy(');
  });

  it('attaches a useSocket method to each stub and prepends the runtime import', () => {
    const code = `import { serverSockets } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx');
    expect(out?.code).toContain('stub.useSocket');
    expect(out?.code).toContain('__$useSocket_hpiso');
    expect(out?.code).toContain(
      `import { useSocket as __$useSocket_hpiso } from 'hono-preact';`
    );
    expect(out?.code).not.toContain('__$useAction');
    expect(out?.code).not.toContain('__$createLoaderStub');
  });

  it('handles serverSockets alongside serverLoaders in the same statement', () => {
    const code = `import { serverLoaders, serverSockets } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx');
    expect(out?.code).toContain('const serverLoaders = new Proxy(');
    expect(out?.code).toContain('const serverSockets = new Proxy(');
    expect(out?.code).toContain('__module');
    expect(out?.code).toContain('__socket');
  });

  it('is left untouched in SSR builds', () => {
    const code = `import { serverSockets } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx', { ssr: true });
    expect(out).toBeUndefined();
  });
});
