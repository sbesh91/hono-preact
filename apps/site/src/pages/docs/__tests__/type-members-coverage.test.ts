import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import knownGaps from './type-members-known-gaps.json' with { type: 'json' };
import { readCodeSpans } from './helpers/docs-corpus.js';

// `exports-coverage.test.ts` checks that every public runtime export is NAMED in
// the docs. It cannot see a level down: `memberIds` and `member` are fields on
// `UseRoomResult`, an already-exported type, so that gate stayed green while two
// fields of a documented API had no documentation at all. This walks the members.
//
// Four decisions, each of which an earlier draft of this file got wrong and a
// mutation caught. They are recorded because every one is the difference between
// a gate that means something and a gate that is green for the wrong reason.
//
// 1. OWN members, resolved through INTERSECTIONS AND UNIONS. Asking the checker
//    for a type's properties returns the APPARENT type: for
//    `type Scope = 'page' | 'loader'` that is String.prototype, and for
//    `NavLinkProps extends AnchorHTMLAttributes` it is every DOM attribute in
//    existence (535 "undocumented members", essentially all noise). Reading only
//    interfaces and type-literal aliases is too narrow the other way: it walks 13
//    documented types as ZERO members, including `ServerActionCtx` (whose
//    `location` is the #288 route-authorization field), `LoaderState`,
//    `ActionResult`, `Outcome`, and both `UseRoomOptions` / `UseSocketOptions`.
//    So: resolve constituents, keep the ones declared under `packages/`, take
//    their declared members.
//
// 2. CO-OCCURRENCE IN ONE SPAN, not co-location on a page. A member counts as
//    documented when it appears in the same code block, inline span or table row
//    as its own type. Requiring only "somewhere on a page that mentions the type"
//    lets a token collision count as documentation: `LoaderCache.get` was
//    satisfied by `get(_, name)` (a Vite Proxy trap) and `LoaderCache.invalidate`
//    by `loader.invalidate()` (a LoaderRef method), while the equally
//    undocumented `set` and `has` were correctly reported. That gate
//    discriminated by how rare a member's name is; 33% of plausible names passed.
//
// 3. CODE ONLY. Member names are ordinary English far more often than export
//    names are (`member`, `send`, `close`, `status`, `value`), so a prose match
//    calls them documented on sight. Same blind spot the export gate still has,
//    where `Show` passes on the word "Show" starting an unrelated sentence.
//
// 4. A PINNED SET, not a floor. A type that stops being named in the docs stops
//    being checked, and a rename is how that happens: renaming `UseRoomResult`
//    took the suite from 99 tests to 92, all green, silently dropping the very
//    fields that motivated this file. The enforced surface is committed and
//    diffed, which also makes the known-gap backlog shrink visibly rather than
//    rot.
const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..');
const repoRoot = resolve(here, '../../../../../..');
const distDir = join(repoRoot, 'packages/hono-preact/dist');

// All six published entry points, matching `exports-coverage.test.ts`. Types
// exported only from a subpath are public too: `HonoPreactAdapter` lives on
// `hono-preact/vite` and is documented in `vite-config.mdx`.
const ENTRIES = [
  'index',
  'page',
  'server',
  'vite',
  'adapter-cloudflare',
  'adapter-node',
].map((e) => join(distDir, `${e}.d.ts`));

const codeSpans = readCodeSpans(docsDir);

/** Is this declaration ours, rather than a lib or a dependency? */
function isOurs(d: ts.Declaration): boolean {
  const f = d.getSourceFile().fileName;
  return f.includes('/packages/') && !f.includes('/node_modules/');
}

/**
 * Members a type declares, resolving intersections, unions and interface
 * heritage down to declarations that live in this repo.
 *
 * Third-party constituents drop out here: `ReadonlySignal` is re-exported from
 * `@preact/signals`, and documenting `peek` / `subscribe` / `toJSON` is that
 * library's job, not this one's.
 */
function declaredMembers(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
  seen: Set<ts.Symbol>
): string[] {
  if (seen.has(sym)) return [];
  seen.add(sym);
  const out = new Set<string>();

  const fromNode = (node: ts.Node): void => {
    if (ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node)) {
      for (const m of node.members) {
        if (!ts.isPropertySignature(m) && !ts.isMethodSignature(m)) continue;
        // Non-identifier names (computed keys like `[FORM_MODULE_FIELD]`, quoted
        // ones like `'data-loader'`) are framework plumbing, not an API a reader
        // looks up. Skipped deliberately.
        if (!m.name || !ts.isIdentifier(m.name)) continue;
        if (m.name.text.startsWith('__')) continue;
        out.add(m.name.text);
      }
      return;
    }
    if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
      for (const t of node.types) fromNode(t);
      return;
    }
    if (ts.isParenthesizedTypeNode(node)) {
      fromNode(node.type);
      return;
    }
    if (ts.isTypeReferenceNode(node)) {
      const ref = checker.getSymbolAtLocation(node.typeName);
      if (!ref) return;
      const target =
        ref.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(ref) : ref;
      if ((target.getDeclarations() ?? []).some(isOurs)) {
        for (const n of declaredMembers(target, checker, seen)) out.add(n);
      }
    }
  };

  for (const d of sym.getDeclarations() ?? []) {
    if (!isOurs(d)) continue;
    if (ts.isInterfaceDeclaration(d)) {
      fromNode(d);
      for (const h of d.heritageClauses ?? []) {
        for (const t of h.types) {
          const ref = checker.getSymbolAtLocation(t.expression);
          if (!ref) continue;
          const target =
            ref.flags & ts.SymbolFlags.Alias
              ? checker.getAliasedSymbol(ref)
              : ref;
          if ((target.getDeclarations() ?? []).some(isOurs)) {
            for (const n of declaredMembers(target, checker, seen)) out.add(n);
          }
        }
      }
    } else if (ts.isTypeAliasDeclaration(d)) {
      fromNode(d.type);
    }
  }
  return [...out];
}

function publicTypeMembers(): { type: string; members: string[] }[] {
  const present = ENTRIES.filter((e) => existsSync(e));
  if (!present.length) {
    throw new Error(
      `no entry .d.ts under ${distDir}; build the framework packages first ` +
        `(step 1 of the pre-push sequence in CLAUDE.md)`
    );
  }
  const program = ts.createProgram(present, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const byType = new Map<string, Set<string>>();

  for (const entry of present) {
    const sf = program.getSourceFile(entry);
    if (!sf) continue;
    const moduleSym = checker.getSymbolAtLocation(sf);
    for (const ex of moduleSym ? checker.getExportsOfModule(moduleSym) : []) {
      const sym =
        ex.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(ex) : ex;
      if (!(sym.getDeclarations() ?? []).some(isOurs)) continue;
      const members = declaredMembers(sym, checker, new Set());
      if (!members.length) continue;
      const set = byType.get(ex.getName()) ?? new Set<string>();
      for (const m of members) set.add(m);
      byType.set(ex.getName(), set);
    }
  }
  return [...byType]
    .map(([type, members]) => ({ type, members: [...members].sort() }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** Documented = the type and the member appear in the SAME code span. */
function documented(type: string, member: string): boolean {
  const t = new RegExp(`\\b${type}\\b`);
  const m = new RegExp(`\\b${member}\\b`);
  return codeSpans.some((s) => t.test(s) && m.test(s));
}

const typeIsDocumented = (type: string): boolean =>
  codeSpans.some((s) => new RegExp(`\\b${type}\\b`).test(s));

// Only types the docs actually document. Whether a type SHOULD be documented is
// the export gate's question; this one answers the narrower "given that it is, is
// every field?". Enforcing it everywhere reports failures on a repo whose docs
// are in good shape, which is a gate nobody lands and therefore nobody keeps.
const enforced = publicTypeMembers().filter((t) => typeIsDocumented(t.type));
const pairs = enforced
  .flatMap((t) => t.members.map((m) => `${t.type}.${m}`))
  .sort();
const undocumented = pairs.filter((p) => {
  const i = p.lastIndexOf('.');
  return !documented(p.slice(0, i), p.slice(i + 1));
});

describe('public type members are documented', () => {
  it('does not introduce a newly undocumented member', () => {
    // A ratchet, not a clean bill of health. The known set is a committed
    // backlog; this fails only on a member that is newly undocumented, which is
    // exactly the `UseRoomResult.memberIds` case that motivated the file.
    const fresh = undocumented.filter(
      (p) => !knownGaps.undocumented.includes(p)
    );
    expect(
      fresh,
      `newly undocumented public type member(s). Cite the field in the same code span as its type ` +
        `(a fenced block, an inline span, or one API-table row), or add it to type-members-known-gaps.json.`
    ).toEqual([]);
  });

  it('does not leave a fixed gap sitting in the known set', () => {
    // Ratchets forward. Without this the backlog only grows and stops
    // describing anything.
    const fixed = knownGaps.undocumented.filter(
      (p) => !undocumented.includes(p)
    );
    expect(
      fixed,
      `documented now (or no longer exist); remove from type-members-known-gaps.json`
    ).toEqual([]);
  });

  it('pins the enforced surface so a rename goes loud', () => {
    // A type that stops being named in the docs stops being checked, silently.
    // Renaming `UseRoomResult` dropped 7 members from the gate and left it
    // green. Diffing the pinned list makes that a visible, reviewable change.
    expect(pairs).toEqual(knownGaps.enforced);
  });
});

describe('the matcher discriminates', () => {
  it('rejects a member documented on the same PAGE but not the same span', () => {
    // The flaw an earlier version shipped with. `LoaderCache` and `get` both
    // appear in loaders.mdx, but never together in one span: the `get` there is
    // a Vite Proxy trap. Page-scoping called that documented.
    const bothOnAPage = readdirSync(docsDir)
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => readFileSync(resolve(docsDir, f), 'utf8'))
      .some((raw) => /\bLoaderCache\b/.test(raw) && /\bget\b/.test(raw));
    expect(bothOnAPage).toBe(true);
    expect(documented('LoaderCache', 'get')).toBe(false);
  });

  it('rejects a name that appears only in prose', () => {
    // Asserted against REAL content. An earlier version used a sentinel that
    // appears nowhere, so it passed under any matcher: replacing the code
    // extraction with raw page text left it green.
    const rooms = readFileSync(resolve(docsDir, 'rooms.mdx'), 'utf8');
    const proseOnly = /reactive and updates on every join/.test(rooms);
    expect(proseOnly).toBe(true);
    // "join" is in that sentence and in no UseRoomResult code span.
    expect(documented('UseRoomResult', 'join')).toBe(false);
  });

  it('accepts a member cited beside its type in one span', () => {
    // A real passing pair, so this asserts the positive direction rather than
    // only the rejections.
    expect(documented('CallResult', 'outcome')).toBe(true);
  });

  it('is honest that most reference tables do NOT satisfy it', () => {
    // Worth pinning, because it explains the 136-entry backlog and stops the
    // next reader assuming the docs are 80% broken. This repo's reference
    // tables list a type's members WITHOUT naming the type in each row: the
    // `useRoom` returns table cites `closeInfo` while `UseRoomResult` is named
    // only in a separate "Type exports" block. Under co-occurrence that reads
    // as undocumented, and it is a real (if mild) attribution gap: nothing in
    // the row tells a reader which type the field belongs to.
    expect(documented('UseRoomResult', 'closeInfo')).toBe(false);
    expect(knownGaps.undocumented).toContain('UseRoomResult.closeInfo');
  });
});
