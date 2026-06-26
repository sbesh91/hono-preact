import { describe, it, expect } from 'vitest';
import { parseArgs } from '../lib/args.mjs';

describe('parseArgs', () => {
  it('parses a bare positional target dir with undefined optionals', () => {
    expect(parseArgs(['my-app'])).toEqual({
      kind: 'scaffold',
      targetDir: 'my-app',
      adapter: undefined,
      ui: undefined,
      install: undefined,
      git: undefined,
      yes: false,
      skipHints: false,
    });
  });

  it('accepts --adapter node (space form)', () => {
    expect(parseArgs(['my-app', '--adapter', 'node']).adapter).toBe('node');
  });

  it('accepts --adapter=cloudflare (equals form)', () => {
    expect(parseArgs(['my-app', '--adapter=cloudflare']).adapter).toBe(
      'cloudflare'
    );
  });

  it('rejects an unknown adapter', () => {
    const r = parseArgs(['my-app', '--adapter=deno']);
    expect(r.kind).toBe('error');
  });

  it('--ui sets ui true, --no-ui sets ui false', () => {
    expect(parseArgs(['a', '--ui']).ui).toBe(true);
    expect(parseArgs(['a', '--no-ui']).ui).toBe(false);
  });

  it('--no-install / --no-git set those false; otherwise undefined', () => {
    expect(parseArgs(['a', '--no-install']).install).toBe(false);
    expect(parseArgs(['a', '--no-git']).git).toBe(false);
    expect(parseArgs(['a']).install).toBe(undefined);
    expect(parseArgs(['a']).git).toBe(undefined);
  });

  it('-y / --yes set yes; --skip-hints sets skipHints', () => {
    expect(parseArgs(['a', '-y']).yes).toBe(true);
    expect(parseArgs(['a', '--yes']).yes).toBe(true);
    expect(parseArgs(['a', '--skip-hints']).skipHints).toBe(true);
  });

  it('still returns help/version', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
  });

  it('rejects unknown flags and extra positionals', () => {
    expect(parseArgs(['a', '--bogus']).kind).toBe('error');
    expect(parseArgs(['a', 'b']).kind).toBe('error');
  });
});

describe('parseArgs — add-agents', () => {
  it('parses add-agents with no flags', () => {
    expect(parseArgs(['add-agents'])).toEqual({
      kind: 'add-agents',
      force: false,
    });
  });
  it('parses add-agents --force', () => {
    expect(parseArgs(['add-agents', '--force'])).toEqual({
      kind: 'add-agents',
      force: true,
    });
  });
  it('rejects an unknown add-agents flag', () => {
    expect(parseArgs(['add-agents', '--bogus'])).toEqual({
      kind: 'error',
      message: 'unknown flag: --bogus',
    });
  });
});
