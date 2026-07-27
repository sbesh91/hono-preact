import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// `exports-coverage.test.ts` checks that every public runtime export is named
// somewhere in the docs. It cannot see a level down: `memberIds` and `member`
// are fields on `UseRoomResult`, an already-exported type, so that gate stayed
// green while two fields of a documented API had no docs at all. This walks the
// members.
//
// Two decisions make the difference between a useful gate and an unlandable
// one, both settled by measuring first:
//
// 1. OWN members only. Asking the checker for a type's properties returns the
//    APPARENT type: for `type Scope = 'page' | 'loader'` that is
//    String.prototype, and for `NavLinkProps extends AnchorHTMLAttributes` it is
//    every DOM attribute that exists. Measured naively this reported 535
//    "undocumented members", essentially all of them noise (`charAt`,
//    `accesskey`, `toExponential`). Reading members off the DECLARATION nodes
//    instead gives what the package actually declares: 186 members across 53
//    types, which is a real surface a human can be responsible for.
//
// 2. CODE-ONLY matching, SCOPED TO A PAGE THAT NAMES THE TYPE. A member counts
//    as documented when its name appears in a fenced code block or an inline
//    `code` span on a page whose code also names the owning type. Both halves
//    are load-bearing, and the first draft of this file got the second one
//    wrong.
//
//    Code-only, because member names are ordinary English far more often than
//    export names are: `member`, `send`, `close`, `status`, `value`, `data`. A
//    prose match calls them documented on sight. That is the blind spot the
//    runtime arm still has, where `Show` passes on the word "Show" starting an
//    unrelated sentence.
//
//    Page-scoped, because a corpus-wide match is barely better. `closeInfo` is
//    cited on two pages; deleting it from one left this gate green, which is the
//    same failure the UI arm of `exports-coverage.test.ts` was hardened against
//    in #222. A member is documented where its type is, or it is not documented.
const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..');
const repoRoot = resolve(here, '../../../../../..');
const ENTRY = join(repoRoot, 'packages/hono-preact/dist/index.d.ts');

// Known gaps, qualified as `Type.member` so an entry cannot over-suppress a
// same-named field on another type. Same contract as the export allowlists in
// `exports-coverage.test.ts`: one stated reason per entry.
//
// This is a seeded BACKLOG, not an endorsement. These are what the gate found
// the day it landed; the honest options were to write the missing docs in the
// same change (a different job) or to record them where they stay visible.
// Deleting an entry and documenting the member is always the better fix.
const INTENTIONALLY_UNDOCUMENTED = new Set<string>([
  // `StreamObserver`'s callbacks ARE documented, on streaming.mdx, but the type
  // itself is only name-dropped on routes.mdx, so the page-scoped rule cannot
  // connect them. The real fix is to document the observer shape where the type
  // is introduced, not to relax the rule.
  'StreamObserver.onStart',
  'StreamObserver.onChunk',
  'StreamObserver.onEnd',
  'StreamObserver.onError',
  'StreamObserver.onAbort',
  // Routing internals that are exported for typing generated code, not for
  // apps to construct by hand. `routes.mdx` documents the authored `RouteDef`
  // shape; these are what the manifest becomes afterward.
  'FlatRoute.component',
  'FlatRoute.key',
  'ServerRoute.ancestors',
  // Escape-hatch cache surface: `loaders.mdx` documents reloading and
  // `prefetch.mdx` the prefetch cache, both through the higher-level API.
  // Direct `set`/`has` are for custom cache plumbing.
  'LoaderCache.set',
  'LoaderCache.has',
  // `WrapperProps.id` is plumbing the generated entry wrapper passes through;
  // structure.mdx documents the wrapper, not this field.
  'WrapperProps.id',
]);

/**
 * Docs text reduced to code: fenced blocks plus inline spans. Prose is dropped
 * on purpose (see decision 2 above).
 */
function readCodePerPage(): string[] {
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(resolve(dir, entry.name));
      } else if (entry.name.endsWith('.mdx')) {
        const raw = readFileSync(resolve(dir, entry.name), 'utf8');
        const parts: string[] = [];
        for (const m of raw.matchAll(/```[\s\S]*?```/g)) parts.push(m[0]);
        for (const m of raw.matchAll(/`[^`\n]+`/g)) parts.push(m[0]);
        pages.push(parts.join('\n'));
      }
    }
  };
  walk(docsDir);
  return pages;
}

type TypeMembers = { type: string; members: string[] };

/**
 * Every member declared by a publicly exported interface or object-shaped type
 * alias, read off the declaration nodes.
 *
 * Third-party types are skipped: `ReadonlySignal` is re-exported from
 * `@preact/signals`, and documenting `peek` / `subscribe` / `toJSON` is that
 * library's job, not this one's. The test is whether the declaration lives
 * under `packages/`.
 */
function publicTypeMembers(): TypeMembers[] {
  const program = ts.createProgram([ENTRY], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(ENTRY);
  if (!sf) {
    throw new Error(
      `missing ${ENTRY}; build the framework packages first (step 1 of the pre-push sequence in CLAUDE.md)`
    );
  }
  const moduleSym = checker.getSymbolAtLocation(sf);
  const out: TypeMembers[] = [];

  for (const ex of moduleSym ? checker.getExportsOfModule(moduleSym) : []) {
    // `export * from ...` yields ALIAS symbols whose declaration is the export
    // specifier, not the interface. Resolve before asking what it is.
    const sym =
      ex.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(ex) : ex;
    const decls = sym.getDeclarations() ?? [];

    const ours = decls.some((d) => {
      const f = d.getSourceFile().fileName;
      return f.includes('/packages/') && !f.includes('/node_modules/');
    });
    if (!ours) continue;

    const members: string[] = [];
    for (const d of decls) {
      const body = ts.isInterfaceDeclaration(d)
        ? d.members
        : ts.isTypeAliasDeclaration(d) && ts.isTypeLiteralNode(d.type)
          ? d.type.members
          : undefined;
      if (!body) continue;
      for (const m of body) {
        if (!ts.isPropertySignature(m) && !ts.isMethodSignature(m)) continue;
        if (!m.name || !ts.isIdentifier(m.name)) continue;
        const n = m.name.text;
        // `__brand`-style fields are compile-time nominal tags, not API.
        if (n.startsWith('__')) continue;
        members.push(n);
      }
    }
    if (members.length) out.push({ type: ex.getName(), members });
  }
  return out.sort((a, b) => a.type.localeCompare(b.type));
}

const codePages = readCodePerPage();
const types = publicTypeMembers();

/**
 * Pages whose code names this type. Empty means the type is not part of the
 * documented surface at all, which is the EXPORT gate's business, not this
 * one's: `exports-coverage.test.ts` decides whether a symbol should appear in
 * the docs. This gate answers the narrower question, and only where the answer
 * is meaningful: given that a type IS documented, is every field of it?
 *
 * Enforcing member coverage for undocumented types instead reports 71 failures
 * on a repo whose docs are in good shape, which is a gate nobody can land and
 * therefore a gate nobody keeps.
 */
function pagesDocumenting(type: string): string[] {
  const t = new RegExp(`\\b${type}\\b`);
  return codePages.filter((page) => t.test(page));
}

/** Documented = named in code on a page whose code also names the owning type. */
function documented(type: string, member: string): boolean {
  const m = new RegExp(`\\b${member}\\b`);
  return pagesDocumenting(type).some((page) => m.test(page));
}

describe('public type members are documented', () => {
  it('walks a meaningful number of documented types', () => {
    // Both halves matter. If the type list empties (moved dist, no build) or if
    // every type falls out as undocumented, every assertion below passes
    // vacuously and the gate silently stops gating.
    const covered = types.filter((t) => pagesDocumenting(t.type).length > 0);
    expect(covered.length).toBeGreaterThan(10);
    expect(covered.flatMap((t) => t.members).length).toBeGreaterThan(40);
  });

  it('finds the exported types to walk', () => {
    // If this list ever empties (a moved dist path, a build that did not run),
    // every assertion below would pass vacuously.
    expect(types.length).toBeGreaterThan(20);
    expect(types.flatMap((t) => t.members).length).toBeGreaterThan(100);
  });

  for (const { type, members } of types) {
    // Skipped rather than failed: see `pagesDocumenting`.
    if (pagesDocumenting(type).length === 0) continue;
    for (const member of members) {
      if (INTENTIONALLY_UNDOCUMENTED.has(`${type}.${member}`)) continue;
      it(`documents ${type}.${member}`, () => {
        expect(
          documented(type, member),
          `${type}.${member} is not named in code on any page that documents ${type}. ` +
            `Prose does not count (member names are ordinary words), and neither does a mention on ` +
            `some other page (a member is documented where its type is).`
        ).toBe(true);
      });
    }
  }
});

describe('the matcher discriminates', () => {
  it('reads inline code spans, not just fenced blocks', () => {
    // API reference tables cite members as `member`, inline. If only fenced
    // blocks counted, every table-documented field would report as missing.
    expect(documented('UseRoomResult', 'closeInfo')).toBe(true);
  });

  it('does not accept a member documented on some OTHER page', () => {
    // The flaw this gate exists to avoid, and which its own first draft had.
    // `closeInfo` is cited on two pages, so a corpus-wide match stayed green
    // when it was removed from one. Scoped to the type's page, a member is
    // documented where its type is or not at all.
    expect(documented('UseRoomResult', 'closeInfo')).toBe(true);
    expect(documented('ThisTypeIsNotInTheDocs', 'closeInfo')).toBe(false);
  });

  it('does not count a name that appears only in prose', () => {
    expect(documented('UseRoomResult', 'zzzprosewordthatisnotcode')).toBe(
      false
    );
  });
});
