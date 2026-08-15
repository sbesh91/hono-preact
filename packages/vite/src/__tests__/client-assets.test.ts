import { describe, it, expect } from 'vitest';
import { contentTypeFor } from '../client-assets.js';

describe('contentTypeFor', () => {
  it('maps the types this API is expected to emit', () => {
    expect(contentTypeFor('llms.txt')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('sw.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('manifest.webmanifest')).toBe(
      'application/manifest+json'
    );
    expect(contentTypeFor('data.json')).toBe('application/json');
    expect(contentTypeFor('feed.xml')).toBe('text/xml; charset=utf-8');
  });

  // `application/wasm` is REQUIRED, not cosmetic: WebAssembly.instantiateStreaming
  // and compileStreaming reject with a TypeError on any other type, so an
  // emitted module served as octet-stream fails to instantiate.
  it('resolves wasm to application/wasm so streaming instantiation works', () => {
    expect(contentTypeFor('mod.wasm')).toBe('application/wasm');
  });

  // Regression guard for the class of bug rather than the one instance: a
  // hand-kept table silently mislabelled everything it omitted. All of these
  // are plausible emitted assets and none were in that table.
  it('resolves types a curated table would have missed', () => {
    expect(contentTypeFor('icon.png')).toBe('image/png');
    expect(contentTypeFor('font.woff2')).toBe('font/woff2');
    expect(contentTypeFor('report.pdf')).toBe('application/pdf');
    expect(contentTypeFor('data.csv')).toBe('text/csv; charset=utf-8');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentTypeFor('thing.zzz')).toBe('application/octet-stream');
    expect(contentTypeFor('noext')).toBe('application/octet-stream');
  });

  it('is case-insensitive on the extension', () => {
    expect(contentTypeFor('LLMS.TXT')).toBe('text/plain; charset=utf-8');
  });

  // charset qualifies text/* only. It is not a defined parameter for
  // application/json (RFC 8259 fixes JSON at UTF-8) or for binary types.
  it('appends charset only to text types', () => {
    expect(contentTypeFor('a.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('icon.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('mod.wasm')).not.toContain('charset');
  });
});

import { emitClientAsset } from '../client-assets.js';
import type { Plugin } from 'vite';
import { vi } from 'vitest';

type Handler = (req: any, res: any, next: (err?: unknown) => void) => void;

function devHandlerFor(plugin: Plugin): Handler {
  const handlers: Handler[] = [];
  const server = { middlewares: { use: (h: Handler) => handlers.push(h) } };
  (plugin.configureServer as any)(server);
  expect(handlers).toHaveLength(1);
  return handlers[0]!;
}

function fakeRes() {
  return {
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(b: unknown) {
      this.body = b;
    },
  };
}

describe('emitClientAsset dev half', () => {
  it('serves a declared asset with the right content type', async () => {
    const handler = devHandlerFor(
      emitClientAsset({ 'llms.txt': () => 'hello' })
    );
    const res = fakeRes();
    const next = vi.fn();
    handler({ url: '/llms.txt' }, res, next);
    await vi.waitFor(() => expect(res.body).toBeDefined());
    expect(res.body).toBe('hello');
    expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(next).not.toHaveBeenCalled();
  });

  it('calls the thunk PER REQUEST so dev edits appear without a restart', async () => {
    let n = 0;
    const handler = devHandlerFor(
      emitClientAsset({ 'llms.txt': () => `v${++n}` })
    );
    const r1 = fakeRes();
    handler({ url: '/llms.txt' }, r1, vi.fn());
    await vi.waitFor(() => expect(r1.body).toBeDefined());
    const r2 = fakeRes();
    handler({ url: '/llms.txt' }, r2, vi.fn());
    await vi.waitFor(() => expect(r2.body).toBeDefined());
    expect(r1.body).toBe('v1');
    expect(r2.body).toBe('v2');
    expect(n).toBe(2);
  });

  it('passes undeclared paths through to the next middleware', () => {
    const handler = devHandlerFor(
      emitClientAsset({ 'llms.txt': () => 'hello' })
    );
    const res = fakeRes();
    const next = vi.fn();
    handler({ url: '/some/page' }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBeUndefined();
  });

  it('ignores the query string when matching', async () => {
    const handler = devHandlerFor(
      emitClientAsset({ 'llms.txt': () => 'hello' })
    );
    const res = fakeRes();
    handler({ url: '/llms.txt?v=2' }, res, vi.fn());
    await vi.waitFor(() => expect(res.body).toBe('hello'));
  });

  it('supports async thunks and Uint8Array', async () => {
    const handler = devHandlerFor(
      emitClientAsset({ 'a.bin': async () => new Uint8Array([1, 2, 3]) })
    );
    const res = fakeRes();
    handler({ url: '/a.bin' }, res, vi.fn());
    await vi.waitFor(() => expect(res.body).toBeDefined());
    expect(Buffer.from(res.body as Buffer)).toEqual(Buffer.from([1, 2, 3]));
    expect(res.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('forwards a thunk failure to next() instead of hanging', async () => {
    const boom = new Error('generation failed');
    const handler = devHandlerFor(
      emitClientAsset({
        'llms.txt': () => {
          throw boom;
        },
      })
    );
    const next = vi.fn();
    handler({ url: '/llms.txt' }, fakeRes(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(boom));
  });
});

describe('emitClientAsset key validation', () => {
  it('accepts a plain root-level name', () => {
    expect(() => emitClientAsset({ 'llms.txt': () => 'x' })).not.toThrow();
  });

  it('accepts a name with a legitimate subdirectory', () => {
    expect(() =>
      emitClientAsset({ '.well-known/security.txt': () => 'x' })
    ).not.toThrow();
  });

  it('rejects an empty key', () => {
    expect(() => emitClientAsset({ '': () => 'x' })).toThrow(/empty/);
  });

  it('rejects a leading slash, naming the offending key', () => {
    expect(() => emitClientAsset({ '/llms.txt': () => 'x' })).toThrow(
      /\/llms\.txt/
    );
  });

  it('rejects a leading ./', () => {
    expect(() => emitClientAsset({ './llms.txt': () => 'x' })).toThrow(
      /\.\/llms\.txt/
    );
  });

  it('rejects a leading ../', () => {
    expect(() => emitClientAsset({ '../llms.txt': () => 'x' })).toThrow(
      /\.\.\/llms\.txt/
    );
  });

  it('rejects a `..` path segment, naming the offending key', () => {
    expect(() => emitClientAsset({ 'a/../b.txt': () => 'x' })).toThrow(
      /a\/\.\.\/b\.txt/
    );
  });

  it('rejects a `:` character, naming the offending key', () => {
    expect(() => emitClientAsset({ 'foo:bar.txt': () => 'x' })).toThrow(
      /foo:bar\.txt/
    );
  });

  it('rejects a `*` character, naming the offending key', () => {
    expect(() => emitClientAsset({ 'foo*.txt': () => 'x' })).toThrow(
      /foo\*\.txt/
    );
  });

  it('rejects a `?` character, naming the offending key', () => {
    expect(() => emitClientAsset({ 'foo?.txt': () => 'x' })).toThrow(
      /foo\?\.txt/
    );
  });
});

describe('emitClientAsset build half', () => {
  function runGenerateBundle(plugin: Plugin, envName: string) {
    const emitted: Array<{ fileName: string; source: unknown }> = [];
    const ctx = {
      environment: { name: envName },
      emitFile: (f: any) =>
        emitted.push({ fileName: f.fileName, source: f.source }),
    };
    return (plugin.generateBundle as any).call(ctx).then(() => emitted);
  }

  it('emits into the client build with the thunk bytes', async () => {
    const emitted = await runGenerateBundle(
      emitClientAsset({ 'llms.txt': () => 'built' }),
      'client'
    );
    expect(emitted).toEqual([{ fileName: 'llms.txt', source: 'built' }]);
  });

  it('emits nothing in a non-client environment', async () => {
    const emitted = await runGenerateBundle(
      emitClientAsset({ 'llms.txt': () => 'built' }),
      'ssr'
    );
    expect(emitted).toEqual([]);
  });

  it('calls each thunk exactly once during the build', async () => {
    let n = 0;
    await runGenerateBundle(
      emitClientAsset({ 'llms.txt': () => `v${++n}` }),
      'client'
    );
    expect(n).toBe(1);
  });

  it('emits root-level names unchanged, which is what /sw.js needs', async () => {
    const emitted = await runGenerateBundle(
      emitClientAsset({ 'sw.js': () => 'self.addEventListener()' }),
      'client'
    );
    expect(emitted[0]!.fileName).toBe('sw.js');
  });
});
