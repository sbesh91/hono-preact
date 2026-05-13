import { describe, it, expect, vi } from 'vitest';
import { serverLoaderValidationPlugin } from '../index.js';
import type { Plugin } from 'vite';

type TransformFn = (code: string, id: string) => void;

function transform(code: string, id: string): { error: string | null } {
  const plugin = serverLoaderValidationPlugin() as Plugin & { transform: TransformFn };
  const context = {
    error: vi.fn((msg: string) => { throw new Error(msg); }),
  };
  try {
    plugin.transform.call(context as any, code, id);
    return { error: null };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

describe('serverLoaderValidationPlugin', () => {
  it('ignores files that are not *.server.* files', () => {
    const { error } = transform('export default function() {}', 'movies.tsx');
    expect(error).toBeNull();
  });

  it('rejects a *.server.* file with only a default export', () => {
    const code = `export default async function serverLoader() { return {}; }`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('may not use a default export');
  });

  it('rejects a *.server.* file with default + serverGuards named export', () => {
    const code = [
      'export default async function serverLoader() { return {}; }',
      'export const serverGuards = [];',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('may not use a default export');
  });

  it('fails when a *.server.* file has a disallowed named export', () => {
    const code = [
      'export const helper = () => {};',
      'export default async function serverLoader() { return {}; }',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('found: helper');
  });

  it('fails when a *.server.* file has neither serverLoaders nor serverActions', () => {
    const code = `export const serverGuards = [];`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain("must export either 'serverLoaders' or 'serverActions'");
  });

  it('fails when a *.server.* file has multiple disallowed named exports', () => {
    const code = [
      'export const helper = () => {};',
      'export const util = () => {};',
      'export const serverLoaders = {};',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('helper');
    expect(error).toContain('util');
  });

  it('fails when a *.server.* file uses export * from', () => {
    const code = [
      `export * from './helpers.js';`,
      `export default async function serverLoader() { return {}; }`,
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('export *');
  });

  it('reports both errors when a file has disallowed exports AND neither serverLoaders nor serverActions', () => {
    const code = `export const helper = () => {};`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('found: helper');
    expect(error).toContain("must export either 'serverLoaders' or 'serverActions'");
  });

  it('rejects a *.server.* file with default + serverActions named export', () => {
    const code = [
      "import { defineAction } from '@hono-preact/iso';",
      'export const serverActions = {',
      '  create: defineAction(async (_ctx, payload) => ({ ok: true })),',
      '};',
      'export default async function serverLoader() { return {}; }',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('may not use a default export');
  });

  it('passes a *.server.* file with only serverActions (no default export)', () => {
    const code = [
      "import { defineAction } from '@hono-preact/iso';",
      'export const serverActions = {',
      '  create: defineAction(async (_ctx, payload) => ({ ok: true })),',
      '};',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('still fails when a *.server.* file has no serverLoaders and no serverActions', () => {
    const code = `export const serverGuards = [];`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain("must export either 'serverLoaders' or 'serverActions'");
  });

  it('passes a *.server.* file with serverActions + serverGuards and no default export', () => {
    const code = [
      'export const serverGuards = [];',
      'export const serverActions = {};',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('passes a *.server.* file with actionGuards as a named export', () => {
    const code = [
      'export const actionGuards = [];',
      'export const serverActions = {};',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('error message lists all allowed named exports (no longer includes loader)', () => {
    const code = [
      'export const unauthorized = () => {};',
      'export const serverLoaders = {};',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain("'serverGuards'");
    expect(error).toContain("'serverActions'");
    expect(error).toContain("'actionGuards'");
    expect(error).not.toContain("'loader'");
    expect(error).toContain("'serverLoaders'");
    expect(error).not.toContain("'cache'");
  });

  describe('serverLoaders named export', () => {
    it('passes a *.server.* file with only serverLoaders (no default export)', () => {
      const code = [
        "import { defineLoader } from '@hono-preact/iso';",
        'const serverLoader = async () => ({});',
        'export const serverLoaders = { default: defineLoader(serverLoader) };',
      ].join('\n');
      const { error } = transform(code, 'movies.server.ts');
      expect(error).toBeNull();
    });

    it('passes a *.server.* file with serverLoaders + serverActions', () => {
      const code = [
        "import { defineLoader, defineAction } from '@hono-preact/iso';",
        'const serverLoader = async () => ({});',
        'export const serverLoaders = { default: defineLoader(serverLoader) };',
        'export const serverActions = { foo: defineAction(async () => ({ ok: true })) };',
      ].join('\n');
      const { error } = transform(code, 'movies.server.ts');
      expect(error).toBeNull();
    });
  });

  describe('legacy loader and cache named exports', () => {
    it('rejects legacy "loader" named export (use serverLoaders instead)', () => {
      const code = [
        'export const serverLoaders = {};',
        'export const loader = defineLoader(serverLoader);',
      ].join('\n');
      const { error } = transform(code, 'movies.server.ts');
      expect(error).toContain('found: loader');
    });

    it('rejects "cache" named export', () => {
      const code = [
        "export const serverLoaders = {};",
        "export const cache = createCache('movies-list');",
      ].join('\n');
      const { error } = transform(code, 'movies.server.ts');
      expect(error).toContain('found: cache');
    });

    it('rejects a default export (use serverLoaders instead)', () => {
      const code = [
        "export const serverLoaders = {};",
        "export default async function serverLoader() { return {}; }",
      ].join('\n');
      const { error } = transform(code, 'movies.server.ts');
      expect(error).toContain('may not use a default export');
    });
  });
});
