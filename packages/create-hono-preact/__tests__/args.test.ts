import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain JS module, no .d.ts
import { parseArgs } from '../lib/args.mjs';

describe('parseArgs', () => {
  it('parses a positional target dir', () => {
    expect(parseArgs(['my-app'])).toEqual({
      kind: 'scaffold',
      targetDir: 'my-app',
      adapter: 'cloudflare',
      install: true,
      git: true,
    });
  });

  it('defaults adapter to cloudflare', () => {
    expect(parseArgs(['my-app']).adapter).toBe('cloudflare');
  });

  it('accepts --adapter=node', () => {
    expect(parseArgs(['my-app', '--adapter=node']).adapter).toBe('node');
  });

  it('accepts --adapter=cloudflare', () => {
    expect(parseArgs(['my-app', '--adapter=cloudflare']).adapter).toBe(
      'cloudflare'
    );
  });

  it('rejects an unknown adapter', () => {
    const result = parseArgs(['my-app', '--adapter=deno']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unknown adapter.*deno/i);
    }
  });

  it('--no-install flips install to false', () => {
    expect(parseArgs(['my-app', '--no-install']).install).toBe(false);
  });

  it('--no-git flips git to false', () => {
    expect(parseArgs(['my-app', '--no-git']).git).toBe(false);
  });

  it('returns kind=help for --help', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('returns kind=help for -h', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('returns kind=version for --version', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('returns kind=scaffold with no targetDir when none given', () => {
    expect(parseArgs([])).toEqual({
      kind: 'scaffold',
      targetDir: undefined,
      adapter: 'cloudflare',
      install: true,
      git: true,
    });
  });

  it('flags can appear before the target dir', () => {
    expect(parseArgs(['--adapter=node', '--no-install', 'my-app'])).toEqual({
      kind: 'scaffold',
      targetDir: 'my-app',
      adapter: 'node',
      install: false,
      git: true,
    });
  });

  it('rejects unknown flags with kind=error', () => {
    const result = parseArgs(['my-app', '--unknown']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unknown flag.*--unknown/i);
    }
  });

  it('rejects multiple positional args', () => {
    const result = parseArgs(['my-app', 'extra']);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/unexpected/i);
    }
  });
});
