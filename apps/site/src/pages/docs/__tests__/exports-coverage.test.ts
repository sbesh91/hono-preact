import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from 'hono-preact';
import * as page from 'hono-preact/page';
import * as server from 'hono-preact/server';
import * as viteApi from 'hono-preact/vite';
import * as cloudflare from 'hono-preact/adapter-cloudflare';
import * as node from 'hono-preact/adapter-node';
import * as ui from 'hono-preact-ui';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '..');

// Public runtime exports that are intentionally undocumented. Each entry is a
// deliberate choice (advanced Vite plumbing, or a feature kept out of the docs);
// add to this set ONLY with a one-line reason.
const INTENTIONALLY_UNDOCUMENTED = new Set<string>([
  // Advanced Vite plugin internals (not part of the documented surface):
  'serverLoaderValidationPlugin',
  'serverOnlyPlugin',
  'VITE_ROOT_ACCESSOR',
  'moduleKeyPlugin',
  'GENERATED_CORE_APP_RELATIVE',
  'GENERATED_ENTRY_WRAPPER_RELATIVE',
  'generatedCoreAppAbsPath',
  'generatedEntryWrapperAbsPath',
  'serverEntryPlugin',
  'clientEntryPlugin',
  'VIRTUAL_CLIENT_ENTRY_ID',
  'guardStripPlugin',
  // Advanced / escape-hatch exports (triaged 2026-06-14): the documented API is
  // the higher-level one noted on each line.
  'ActionResultContext', // low-level SSR context; useActionResult() is the documented API
  'isTimeout', // advanced predicate for inspecting timeout outcomes in custom handler code; timeouts themselves are documented via timeoutMs
  'timeoutOutcome', // advanced constructor for timeout outcomes in custom handler code; timeouts themselves are documented via timeoutMs
  'useRoute', // raw preact-iso re-export; useParams() is the documented route-params API
]);

// Public `hono-preact-ui` exports that are intentionally undocumented. Same
// contract as the runtime allowlist above: one stated reason per entry. Empty
// today (every UI export is documented); it exists so a deliberate future
// exception has a home instead of loosening the gate.
const UI_INTENTIONALLY_UNDOCUMENTED = new Set<string>([]);

function runtimeNames(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((k) => k !== 'default');
}

// Compound UI components export a namespace object (`Dialog`) plus flat parts
// (`DialogClose`), and the docs cite parts in dot form (`Dialog.Close`). A
// namespace root is a top-level component name that prefixes other exports;
// deriving them from the barrel (rather than hardcoding) keeps this in sync as
// components are added.
function namespaceRoots(names: string[]): string[] {
  return names.filter(
    (n) =>
      /^[A-Z]/.test(n) &&
      names.some((o) => o !== n && o.startsWith(n)) &&
      !names.some((m) => m !== n && n.startsWith(m))
  );
}

// `PascalCase`/`camelCase` -> `kebab-case` (`useControllableState` ->
// `use-controllable-state`, `ContextMenu` -> `context-menu`), the naming
// convention that maps a UI export to its dedicated `components/<kebab>.mdx`.
const kebab = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

// UI exports documented on a SHARED page instead of a dedicated
// `components/<kebab>.mdx` one (submenus live on the menu page; a few filter /
// positioning utils on a component / hook page). One stated home per entry;
// add to this map ONLY with the page the export is actually documented on.
const UI_SHARED_PAGE = new Map<string, string>([
  ['SubmenuRoot', 'menu.mdx'],
  ['SubmenuTrigger', 'menu.mdx'],
  ['SubmenuPopup', 'menu.mdx'],
  ['SubmenuPositioner', 'menu.mdx'],
  ['matchSubstring', 'combobox.mdx'],
  ['placementFor', 'use-position.mdx'],
  ['sideAlignFromPlacement', 'use-position.mdx'],
  ['normalizeSelectionProps', 'use-listbox-selection.mdx'],
]);

// The `components/<file>.mdx` page that OWNS a UI export's documentation: an
// explicit shared page, else a namespace part on its root's page, else the
// export's own dedicated kebab page.
function owningPageFile(name: string, roots: string[]): string {
  const shared = UI_SHARED_PAGE.get(name);
  if (shared) return shared;
  const root = roots.find((r) => name.startsWith(r) && name.length > r.length);
  return `${kebab(root ?? name)}.mdx`;
}

// Is `name` documented on its OWNING page? The page must EXIST (a deleted page
// reads as undocumented -- the gap this closes: a whole-corpus match passed
// green when a single-symbol page was deleted but the symbol was still
// name-dropped on a sibling page) and cite the symbol flat or, for a namespace
// part, in `Root.Part` dot form. `readPage` is injected so the deleted-page
// behavior is unit-testable without touching the filesystem.
function isDocumented(
  name: string,
  roots: string[],
  readPage: (file: string) => string | undefined
): boolean {
  const content = readPage(owningPageFile(name, roots));
  if (content === undefined) return false;
  if (new RegExp(`\\b${name}\\b`).test(content)) return true;
  const root = roots.find((r) => name.startsWith(r) && name.length > r.length);
  if (root) {
    const part = name.slice(root.length);
    return new RegExp(`\\b${root}\\.${part}\\b`).test(content);
  }
  return false;
}

function readCorpus(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(resolve(dir, entry.name));
      } else if (entry.name.endsWith('.mdx')) {
        parts.push(readFileSync(resolve(dir, entry.name), 'utf8'));
      }
    }
  };
  walk(docsDir);
  return parts.join('\n');
}

const corpus = readCorpus();

// Reads a UI component doc page's content, or `undefined` if the page does not
// exist. Injected into `isDocumented` so the deleted-page path is testable.
const componentsDir = resolve(docsDir, 'components');
const readComponentPage = (file: string): string | undefined => {
  const p = resolve(componentsDir, file);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
};

const allExports = [
  ...runtimeNames(root),
  ...runtimeNames(page),
  ...runtimeNames(server),
  ...runtimeNames(viteApi),
  ...runtimeNames(cloudflare),
  ...runtimeNames(node),
];

describe('public runtime exports are documented', () => {
  for (const name of [...new Set(allExports)].sort()) {
    if (INTENTIONALLY_UNDOCUMENTED.has(name)) continue;
    it(`documents ${name}`, () => {
      expect(
        new RegExp(`\\b${name}\\b`).test(corpus),
        `${name} not found in docs`
      ).toBe(true);
    });
  }
});

const uiExports = [...new Set(runtimeNames(ui))].sort();
const uiRoots = namespaceRoots(uiExports);

describe('public UI exports are documented', () => {
  for (const name of uiExports) {
    if (UI_INTENTIONALLY_UNDOCUMENTED.has(name)) continue;
    it(`documents ${name}`, () => {
      expect(
        isDocumented(name, uiRoots, readComponentPage),
        `${name} not documented on its owning components/ page ` +
          `(${owningPageFile(name, uiRoots)})`
      ).toBe(true);
    });
  }
});

// Regression (#222 item 19): the UI gate must catch a DELETED owning page. The
// previous whole-corpus match passed green when a single-symbol page was deleted
// but the symbol was still name-dropped on a sibling page. These lock the
// owning-page scoping via an injected `readPage` (no real filesystem mutation).
describe('UI docs gate catches a deleted owning page', () => {
  it('a standalone hook reads undocumented when its own page is deleted', () => {
    const deleted = 'use-controllable-state.mdx';
    const readWithout = (file: string) =>
      file === deleted ? undefined : readComponentPage(file);
    // Present -> documented (guards against a vacuous always-false).
    expect(
      isDocumented('useControllableState', uiRoots, readComponentPage)
    ).toBe(true);
    // Deleted -> undocumented, even though the symbol is still cited elsewhere.
    expect(isDocumented('useControllableState', uiRoots, readWithout)).toBe(
      false
    );
  });

  // Pins the namespace-part path specifically: `DialogClose` is cited on
  // dialog.mdx in dot form (`Dialog.Close`), not flat, so this also exercises
  // the `Root.Part` matcher, which the flat-only hook case above does not.
  it('a namespace part reads undocumented when its root page is deleted', () => {
    const readWithout = (file: string) =>
      file === 'dialog.mdx' ? undefined : readComponentPage(file);
    expect(isDocumented('DialogClose', uiRoots, readComponentPage)).toBe(true);
    expect(isDocumented('DialogClose', uiRoots, readWithout)).toBe(false);
  });

  it('a shared-page export reads undocumented when its shared page is deleted', () => {
    const readWithout = (file: string) =>
      file === 'menu.mdx' ? undefined : readComponentPage(file);
    expect(isDocumented('SubmenuRoot', uiRoots, readComponentPage)).toBe(true);
    expect(isDocumented('SubmenuRoot', uiRoots, readWithout)).toBe(false);
  });
});

// The gate's core job: a symbol DROPPED from an existing owning page (page
// present, symbol absent) must read undocumented. The deleted-page cases above
// all return early on the missing page, so these lock the "page exists but does
// not cite the symbol" branch -- flat AND `Root.Part` dot form both absent.
describe('UI docs gate catches a symbol dropped from a present owning page', () => {
  it('a standalone hook whose own page no longer cites it reads undocumented', () => {
    const stubbed = (file: string) =>
      file === 'use-controllable-state.mdx'
        ? '# Some Page\n\nunrelated prose, no symbol here.'
        : readComponentPage(file);
    expect(isDocumented('useControllableState', uiRoots, stubbed)).toBe(false);
  });

  it('a namespace part absent from its root page (flat and dot form) reads undocumented', () => {
    const stubbed = (file: string) =>
      file === 'dialog.mdx'
        ? '# Dialog\n\nno parts cited here.'
        : readComponentPage(file);
    expect(isDocumented('DialogClose', uiRoots, stubbed)).toBe(false);
  });
});
