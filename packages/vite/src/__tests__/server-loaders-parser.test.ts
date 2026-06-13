import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import type { Program } from '@babel/types';
import {
  parseServerLoaders,
  readParamsOpt,
  hasNamedUseExport,
  RECOGNIZED_USE_EXPORTS,
  findUseExports,
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

  it('reads opts from the third arg for the route-id form', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        x: defineLoader('/things/:id', async () => ({}), { params: ['q'] }),
      };
    `);
    const [entry] = parseServerLoaders(program);
    expect(entry.optsArg?.type).toBe('ObjectExpression');
  });

  it('route-id form with no opts has optsArg === null', () => {
    const program = parseProgram(`
      export const serverLoaders = {
        x: defineLoader('/things/:id', async () => ({})),
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
});

describe('use exports', () => {
  it('lists the recognized use-export names', () => {
    expect(RECOGNIZED_USE_EXPORTS.has('pageUse')).toBe(true);
    expect(RECOGNIZED_USE_EXPORTS.has('loaderUse')).toBe(true);
    expect(RECOGNIZED_USE_EXPORTS.has('actionUse')).toBe(true);
  });

  it('detects a top-level pageUse named export', () => {
    const program = parseProgram(`
      import { defineServerMiddleware } from '@hono-preact/iso';
      const mw = defineServerMiddleware(async (_c, next) => { await next(); });
      export const pageUse = [mw];
      export const serverLoaders = { x: defineLoader(async () => ({})) };
    `);
    expect(hasNamedUseExport(program, 'pageUse')).toBe(true);
  });

  it('returns false when pageUse is absent', () => {
    const program = parseProgram(`
      export const serverLoaders = { x: defineLoader(async () => ({})) };
    `);
    expect(hasNamedUseExport(program, 'pageUse')).toBe(false);
  });

  it('parseServerLoaders ignores a sibling pageUse export', () => {
    const program = parseProgram(`
      export const pageUse = [];
      export const serverLoaders = {
        x: defineLoader(async () => ({})),
      };
    `);
    const entries = parseServerLoaders(program);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('x');
  });
});

describe('findUseExports', () => {
  it('returns one entry per recognized use-export, with the init expression captured', () => {
    const program = parseProgram(`
      export const pageUse = [];
      export const loaderUse = [a, b];
      export const actionUse = c;
      export const serverLoaders = {};
    `);
    const found = findUseExports(program);
    expect(found.map((e) => e.name).sort()).toEqual([
      'actionUse',
      'loaderUse',
      'pageUse',
    ]);
    const pageEntry = found.find((e) => e.name === 'pageUse');
    expect(pageEntry?.init?.type).toBe('ArrayExpression');
    const loaderEntry = found.find((e) => e.name === 'loaderUse');
    expect(loaderEntry?.init?.type).toBe('ArrayExpression');
    const actionEntry = found.find((e) => e.name === 'actionUse');
    expect(actionEntry?.init?.type).toBe('Identifier');
  });

  it('returns [] when none of the recognized names are exported', () => {
    const program = parseProgram(`
      export const serverLoaders = {};
      export const serverActions = {};
    `);
    expect(findUseExports(program)).toEqual([]);
  });

  it('ignores unrecognized export names sharing a similar shape', () => {
    const program = parseProgram(`
      export const otherUse = [];
      export const serverLoaders = {};
    `);
    expect(findUseExports(program)).toEqual([]);
  });
});

describe('readParamsOpt', () => {
  function optsFrom(code: string) {
    const program = parseProgram(`
      export const serverLoaders = { x: defineLoader(fn, ${code}) };
    `);
    const [entry] = parseServerLoaders(program);
    return entry.optsArg!;
  }

  it('returns string[] for array of string literals', () => {
    const opts = optsFrom(`{ params: ['genre', 'id'] }`);
    expect(readParamsOpt(opts)).toEqual(['genre', 'id']);
  });

  it("returns '*' for the wildcard string literal", () => {
    const opts = optsFrom(`{ params: '*' }`);
    expect(readParamsOpt(opts)).toBe('*');
  });

  it('returns undefined when params is absent', () => {
    const opts = optsFrom(`{ cache: true }`);
    expect(readParamsOpt(opts)).toBeUndefined();
  });

  it('returns undefined for an unsupported params shape (non-wildcard string)', () => {
    const opts = optsFrom(`{ params: 'something' }`);
    expect(readParamsOpt(opts)).toBeUndefined();
  });

  it('returns undefined for an empty array', () => {
    const opts = optsFrom(`{ params: [] }`);
    expect(readParamsOpt(opts)).toBeUndefined();
  });
});
