import { describe, it, expect, vi } from 'vitest';
import { serverOnlyPlugin, serverLoaderValidationPlugin } from '../index.js';
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

type ValidationTransformFn = (code: string, id: string) => void;

function validateTransform(code: string, id: string): { error: string | null } {
  const plugin = serverLoaderValidationPlugin() as Plugin & {
    transform: ValidationTransformFn;
  };
  const context = {
    error: vi.fn((msg: string) => {
      throw new Error(msg);
    }),
  };
  try {
    plugin.transform.call(context as any, code, id);
    return { error: null };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

describe('serverOnlyPlugin: serverRooms', () => {
  it('rewrites a client import of serverRooms into a descriptor proxy', () => {
    const code = `import { serverRooms } from '/proj/src/pages/chat.server.js';`;
    const out = transform(code, '/proj/src/app.tsx');
    expect(out?.code).toContain('new Proxy');
    expect(out?.code).toContain('__module');
    expect(out?.code).toContain('__room');
  });

  it('stub carries the correct module key from the import source path', () => {
    const code = `import { serverRooms } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx');
    expect(out?.code).toContain('"src/pages/chat"');
  });

  it('uses the local binding name in the stub declaration', () => {
    const code = `import { serverRooms as rooms } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx');
    expect(out?.code).toContain('const rooms = new Proxy(');
    expect(out?.code).not.toContain('const serverRooms = new Proxy(');
  });

  it('attaches a useRoom method to each stub and prepends the runtime import', () => {
    const code = `import { serverRooms } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx');
    expect(out?.code).toContain('stub.useRoom');
    expect(out?.code).toContain('__$useRoom_hpiso');
    expect(out?.code).toContain(
      `import { useRoom as __$useRoom_hpiso } from 'hono-preact';`
    );
    expect(out?.code).not.toContain('__$useAction');
    expect(out?.code).not.toContain('__$createLoaderStub');
  });

  it('handles serverRooms alongside serverLoaders in the same statement', () => {
    const code = `import { serverLoaders, serverRooms } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx');
    expect(out?.code).toContain('const serverLoaders = new Proxy(');
    expect(out?.code).toContain('const serverRooms = new Proxy(');
    expect(out?.code).toContain('__module');
    expect(out?.code).toContain('__room');
  });

  it('is left untouched in SSR builds', () => {
    const code = `import { serverRooms } from './chat.server.js';`;
    const out = transform(code, '/proj/src/pages/chat.tsx', { ssr: true });
    expect(out).toBeUndefined();
  });
});

describe('serverLoaderValidationPlugin: serverRooms', () => {
  it('passes a *.server.* file with only serverRooms (no default export)', () => {
    const code = [
      "import { defineRoom } from '@hono-preact/iso';",
      'export const serverRooms = { chat: defineRoom({}) };',
    ].join('\n');
    const { error } = validateTransform(code, 'chat.server.ts');
    expect(error).toBeNull();
  });
});
