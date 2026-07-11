import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  clientEntryPlugin,
  generateClientEntrySource,
  VIRTUAL_CLIENT_ENTRY_ID,
} from '../client-entry.js';

type MinimalResolvedConfig = {
  root: string;
  command?: string;
  build?: { cssCodeSplit?: boolean };
};

function configResolvedOf(plugin: ReturnType<typeof clientEntryPlugin>) {
  return (plugin as { configResolved?: (c: MinimalResolvedConfig) => void })
    .configResolved;
}

describe('VIRTUAL_CLIENT_ENTRY_ID', () => {
  it('is the documented virtual module id', () => {
    expect(VIRTUAL_CLIENT_ENTRY_ID).toBe('virtual:hono-preact/client');
  });
});

describe('generateClientEntrySource', () => {
  it('emits the framework imports plus the user routes import (absolute path)', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });

    expect(src).toContain(`import { h, hydrate } from 'preact';`);
    expect(src).toContain(`import { LocationProvider } from 'preact-iso';`);
    expect(src).toContain(`import { Routes, bootClient } from 'hono-preact';`);
    expect(src).toContain(`import routes from '/proj/src/routes.ts';`);
    // The boot contract is the public one a custom clientEntry follows too;
    // the internal runtime door must not leak into the emitted entry.
    expect(src).not.toContain('hono-preact/internal/runtime');
  });

  it('hydrates into #app', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    expect(src).toContain(`document.getElementById('app')`);
  });

  it('calls bootClient() before hydrate()', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    const bootIdx = src.indexOf('bootClient();');
    const hydrateIdx = src.indexOf('hydrate(');
    expect(bootIdx).toBeGreaterThan(-1);
    expect(hydrateIdx).toBeGreaterThan(-1);
    expect(bootIdx).toBeLessThan(hydrateIdx);
  });
});

describe('clientEntryPlugin', () => {
  it('resolveId returns the resolved id only for the virtual id', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({
      root: '/proj',
    });

    const resolved = (
      plugin as {
        resolveId?: (id: string) => string | undefined;
      }
    ).resolveId?.(VIRTUAL_CLIENT_ENTRY_ID);
    expect(resolved).toBe('\0' + VIRTUAL_CLIENT_ENTRY_ID);

    const other = (
      plugin as {
        resolveId?: (id: string) => string | undefined;
      }
    ).resolveId?.('not-the-virtual');
    expect(other).toBeUndefined();
  });

  it('load() returns the generated source for the resolved virtual id', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({
      root: '/proj',
    });

    const code = (
      plugin as {
        load?: (id: string) => string | undefined;
      }
    ).load?.('\0' + VIRTUAL_CLIENT_ENTRY_ID);

    expect(code).toContain(
      `import routes from '${path.resolve('/proj', 'src/routes.ts')}';`
    );
  });

  it('load() returns undefined for non-virtual ids', () => {
    const plugin = clientEntryPlugin({ routes: 'src/routes.ts' });
    (
      plugin as { configResolved?: (c: { root: string }) => void }
    ).configResolved?.({
      root: '/proj',
    });
    const code = (
      plugin as { load?: (id: string) => string | undefined }
    ).load?.('other-id');
    expect(code).toBeUndefined();
  });
});

describe('clientEntryPlugin css.global validation', () => {
  // Resolved against config.root (not process.cwd()): these fixtures live
  // under a real temp directory, and root is set to that temp directory, so
  // the tests exercise the actual filesystem check regardless of the cwd the
  // test runner happens to invoke from.
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hono-preact-css-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('throws when css.global points at a missing file', () => {
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: 'does-not-exist.css',
    });
    expect(() => configResolvedOf(plugin)?.({ root: tmpRoot })).toThrow(
      /css\.global/
    );
  });

  it('throws when css.global is an empty string (resolves to the root dir, not a file)', () => {
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: '',
    });
    expect(() => configResolvedOf(plugin)?.({ root: tmpRoot })).toThrow(
      /css\.global/
    );
  });

  it('throws when css.global points at a directory', () => {
    const dir = path.join(tmpRoot, 'a-directory');
    fs.mkdirSync(dir);
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: 'a-directory',
    });
    expect(() => configResolvedOf(plugin)?.({ root: tmpRoot })).toThrow(
      /css\.global/
    );
  });

  it('accepts css.global pointing at an existing file', () => {
    fs.writeFileSync(path.join(tmpRoot, 'root.css'), 'body{color:red}');
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: 'root.css',
    });
    expect(() => configResolvedOf(plugin)?.({ root: tmpRoot })).not.toThrow();
  });

  it('resolves css.global against config.root, not process.cwd() (root differs from cwd)', () => {
    // The regression this proves: a valid file that lives under `root` but
    // NOT under process.cwd() must validate cleanly. process.cwd() here is
    // the monorepo checkout, which does not contain tmpRoot, so a
    // cwd-resolved check would have thrown "not a file" for this case.
    expect(tmpRoot.startsWith(process.cwd())).toBe(false);
    fs.writeFileSync(path.join(tmpRoot, 'root.css'), 'body{color:red}');
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: 'root.css',
    });
    expect(() => configResolvedOf(plugin)?.({ root: tmpRoot })).not.toThrow();
  });

  it('accepts css.global nested under a subdirectory of root, not just root itself', () => {
    const root = path.join(tmpRoot, 'project');
    fs.mkdirSync(path.join(root, 'src', 'styles'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src', 'styles', 'root.css'),
      'body{color:red}'
    );
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: 'src/styles/root.css',
    });
    expect(() => configResolvedOf(plugin)?.({ root })).not.toThrow();
  });

  it('throws when css.global resolves outside config.root (a dev URL the dev server cannot serve)', () => {
    // A file that exists and is a real stylesheet, but escapes root via a
    // '../' path: the dev server resolves URLs against root, so this would
    // 404 in dev (e.g. /../shared.css) even though the file itself is fine.
    const root = path.join(tmpRoot, 'project');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(tmpRoot, 'shared.css'), 'body{color:red}');
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: '../shared.css',
    });
    expect(() => configResolvedOf(plugin)?.({ root })).toThrow(
      /css\.global must live under the project root/
    );
  });

  it('throws when css.global is an absolute path outside config.root', () => {
    const root = path.join(tmpRoot, 'project');
    fs.mkdirSync(root);
    const outsideFile = path.join(tmpRoot, 'shared.css');
    fs.writeFileSync(outsideFile, 'body{color:red}');
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: outsideFile,
    });
    expect(() => configResolvedOf(plugin)?.({ root })).toThrow(
      /css\.global must live under the project root/
    );
  });

  it('throws when css.global is set and build.cssCodeSplit is disabled', () => {
    fs.writeFileSync(path.join(tmpRoot, 'root.css'), 'body{color:red}');
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: 'root.css',
    });
    expect(() =>
      configResolvedOf(plugin)?.({
        root: tmpRoot,
        build: { cssCodeSplit: false },
      })
    ).toThrow(/cssCodeSplit/);
  });

  it('accepts css.global when cssCodeSplit is left at its default (true)', () => {
    fs.writeFileSync(path.join(tmpRoot, 'root.css'), 'body{color:red}');
    const plugin = clientEntryPlugin({
      routes: 'src/routes.ts',
      cssGlobal: 'root.css',
    });
    expect(() =>
      configResolvedOf(plugin)?.({
        root: tmpRoot,
        build: { cssCodeSplit: true },
      })
    ).not.toThrow();
    // Also fine when `build` is entirely absent from the resolved config
    // fixture (matches the other tests in this file, and Vite's real default).
    expect(() => configResolvedOf(plugin)?.({ root: tmpRoot })).not.toThrow();
  });
});
