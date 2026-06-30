import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import type { Program } from '@babel/types';
import {
  parseServerLoaders,
  readParamsOption,
} from '../server-loaders-parser.js';
import { BABEL_PARSER_PLUGINS } from '../parser-options.js';

function parseProgram(code: string): Program {
  return parse(code, {
    sourceType: 'module',
    plugins: BABEL_PARSER_PLUGINS,
    errorRecovery: true,
  }).program;
}

describe('parseServerLoaders', () => {
  it('happy path: returns one entry per defineLoader property', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        summary: defineLoader(async () => ({})),
        cast: defineLoader(async () => [], { params: '*' }),
      };
    `);
    const entries = parseServerLoaders(program);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('summary');
    expect(entries[0].call.type).toBe('CallExpression');
    expect(entries[0].optsArg).toBeNull();
    expect(entries[1].name).toBe('cast');
    expect(entries[1].optsArg).not.toBeNull();
    expect(entries[1].optsArg?.type).toBe('ObjectExpression');
  });

  it('returns [] when serverLoaders is absent', () => {
    const program = parseProgram(`
      export const loader = defineLoader(async () => ({}));
    `);
    expect(parseServerLoaders(program)).toEqual([]);
  });

  it('returns [] when serverLoaders is an empty object', () => {
    const program = parseProgram(`
      export const serverLoaders = {};
    `);
    expect(parseServerLoaders(program)).toEqual([]);
  });

  it('skips spread elements in serverLoaders', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        ...extra,
        valid: defineLoader(async () => ({})),
      };
    `);
    const entries = parseServerLoaders(program);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('valid');
  });

  it('skips properties with non-Identifier keys (e.g. string literal keys)', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        "string-key": defineLoader(async () => ({})),
        valid: defineLoader(async () => ({})),
      };
    `);
    const entries = parseServerLoaders(program);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('valid');
  });

  it('skips properties whose value is not a CallExpression', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        notACall: someValue,
        valid: defineLoader(async () => ({})),
      };
    `);
    const entries = parseServerLoaders(program);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('valid');
  });

  it('skips call expressions that are not defineLoader', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        wrong: otherFn(async () => ({})),
        valid: defineLoader(async () => ({})),
      };
    `);
    const entries = parseServerLoaders(program);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('valid');
  });

  it('defineLoader with no opts has optsArg === null', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        x: defineLoader(async () => ({})),
      };
    `);
    const [entry] = parseServerLoaders(program);
    expect(entry.optsArg).toBeNull();
  });

  it('defineLoader with non-ObjectExpression second arg has optsArg === null', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        x: defineLoader(async () => ({}), someVar),
      };
    `);
    const [entry] = parseServerLoaders(program);
    expect(entry.optsArg).toBeNull();
  });

  it('recognizes serverRoute().loader(...) factory calls', () => {
    const program = parseProgram(`
      const route = serverRoute('/things/:id');
      export const serverLoaders = {
        a: route.loader(async () => ({})),
        b: route.loader(async () => ({}), { params: ['q'] }),
      };
    `);
    const entries = parseServerLoaders(program);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('a');
    expect(entries[0].optsArg).toBeNull();
    expect(entries[1].name).toBe('b');
    expect(entries[1].optsArg?.type).toBe('ObjectExpression');
  });

  it('ignores a sibling loaderUse export', () => {
    const program = parseProgram(`
      export const loaderUse = [];
      export const serverLoaders = {
        x: defineLoader(async () => ({})),
      };
    `);
    const entries = parseServerLoaders(program);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('x');
  });
});

describe('readParamsOption', () => {
  function optsFrom(code: string) {
    const program = parseProgram(`
      export const serverLoaders = { x: defineLoader(fn, ${code}) };
    `);
    const [entry] = parseServerLoaders(program);
    return entry.optsArg!;
  }

  it('returns string[] for array of string literals', () => {
    const opts = optsFrom(`{ params: ['genre', 'id'] }`);
    expect(readParamsOption(opts)).toEqual(['genre', 'id']);
  });

  it("returns '*' for the wildcard string literal", () => {
    const opts = optsFrom(`{ params: '*' }`);
    expect(readParamsOption(opts)).toBe('*');
  });

  it('returns undefined when params is absent', () => {
    const opts = optsFrom(`{ cache: true }`);
    expect(readParamsOption(opts)).toBeUndefined();
  });

  it('returns undefined for an unsupported params shape (non-wildcard string)', () => {
    const opts = optsFrom(`{ params: 'something' }`);
    expect(readParamsOption(opts)).toBeUndefined();
  });

  it('returns undefined for an empty array', () => {
    const opts = optsFrom(`{ params: [] }`);
    expect(readParamsOption(opts)).toBeUndefined();
  });
});
