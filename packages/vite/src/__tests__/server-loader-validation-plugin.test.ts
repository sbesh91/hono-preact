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

  it('passes a *.server.* file with only a default export', () => {
    const code = `export default async function serverLoader() { return {}; }`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('passes a *.server.* file with default + serverGuards named export', () => {
    const code = [
      'export default async function serverLoader() { return {}; }',
      'export const serverGuards = [];',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('fails when a *.server.* file has a disallowed named export', () => {
    const code = [
      'export const helper = () => {};',
      'export default async function serverLoader() { return {}; }',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('found: helper');
  });

  it('fails when a *.server.* file has no default export', () => {
    const code = `export const serverGuards = [];`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('must have a default export');
  });

  it('fails when a *.server.* file has multiple disallowed named exports', () => {
    const code = [
      'export const helper = () => {};',
      'export const util = () => {};',
      'export default async function serverLoader() { return {}; }',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('helper');
    expect(error).toContain('util');
  });
});
