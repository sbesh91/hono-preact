import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hp from 'hono-preact';

// Drift guard for issue #282: every RUNTIME export of the framework's main
// entry must either be imported somewhere in the demo surface or carry an
// explicit allowlist reason. Type-only exports are invisible to Object.keys
// and are out of scope by design. A stale allowlist entry (the symbol got
// covered) fails too, so the list cannot rot in either direction. The scan
// also matches the `hono-preact/page` subpath so dual-exported symbols count
// as covered when the demo reaches them only that way; subpath-only symbols
// that are not main-entry exports (like `render`) simply never appear in
// Object.keys(hp) and are ignored by the diff.

const here = dirname(fileURLToPath(import.meta.url));
const SCAN_ROOTS = [
  '../demo',
  '../pages/demo',
  '../components/demo',
  '../server',
].map((p) => join(here, p));
const EXTRA_FILES = ['../routes.ts', '../app-config.ts', '../api.ts'].map((p) =>
  join(here, p)
);

const ALLOWLIST: Record<string, string> = {
  // Seed entries; the implementer completes this empirically (see Step 2).
  // Every entry needs a one-line reason tied to WHY the demo cannot or need
  // not exercise it.
  bootClient: 'custom client entries only; the demo uses the generated entry',
  ClientScript: 'document plumbing emitted by the framework layout',
  Head: 'document plumbing used by the site root Layout.tsx, not demo code',
  Router: 'low-level preact-iso re-export; demo uses the route tree',
  Route: 'low-level preact-iso re-export',
  Routes: 'consumed by the generated entries, not app code',
  lazy: 'low-level preact-iso re-export',
  defineSocket:
    'route-independent socket variant; the demo covers serverRoute(r).socket',
  useSocket:
    'free-function form; the demo uses the ref-method serverSockets.x.useSocket',
  useRoom:
    'free-function form; the demo uses the ref-method serverRooms.x.useRoom',
  skipNextNavTransition:
    'exercised through NavLink transition={false} in the board chips',
  prefetch: 'imperative form; the demo covers usePrefetch',
  createCaller: 'exercised by the demo server tests, not shipped demo code',
  isBrowser: 'internal-leaning helper with no natural demo surface',
  ActionResultContext:
    'low-level SSR context; the demo uses useActionResult (login.tsx) as the documented API',
  DENY_CODE_STATUS:
    'internal status-code lookup behind deny(); the demo calls deny() directly and never inspects the code table',
  LoaderValidationError:
    'thrown internally by the framework on failed loader validation; the demo relies on the framework surfacing it as a 400 response and never catches or constructs it directly',
  Page: 'manual escape-hatch component; every demo page uses definePage() instead',
  defineRoom:
    'route-independent room variant; the demo covers serverRoute(r).room (cursors-demo.server.ts)',
  getValidationIssues:
    'low-level issue reader; the demo uses the useFieldErrors hook built on top (NewTaskDialog.tsx)',
  isDeny: 'exercised by the demo server tests, not shipped demo code',
  isOutcome:
    'generic outcome-shape predicate; the demo always narrows with the specific isDeny/isRedirect/isRender predicates',
  isRedirect: 'exercised by the demo server tests, not shipped demo code',
  isRender: 'exercised by the demo server tests, not shipped demo code',
  isTimeout:
    'advanced timeout-outcome predicate; no demo loader or action times out',
  subscribeViewTransitionTypes:
    'used by the site-wide docs-transition.ts subscriber, outside the demo surface',
  timeoutOutcome:
    'advanced timeout-outcome constructor; no demo loader or action times out',
  useLang:
    'hoofd re-export for switching <html lang>; the demo is single-language and never calls it',
  useRouteActive:
    'used by the site chrome (DocsLayout.tsx), outside the demo surface',
  useScript:
    'hoofd re-export for injecting third-party <script> tags; the demo needs none',
  useViewTransitionClass:
    'ref-callback hook form; the demo uses the ViewTransitionGroup component (Board.tsx) built on it',
};

function collectFiles(root: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out = out.concat(collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function importedNames(source: string): string[] {
  const names: string[] = [];
  // Value imports only: `import type {...}` exercises nothing at runtime.
  const re = /import\s+\{([^}]+)\}\s+from\s+'hono-preact(?:\/page)?'/g;
  for (const m of source.matchAll(re)) {
    for (const raw of m[1].split(',')) {
      const item = raw.trim();
      if (!item || item.startsWith('type ')) continue;
      names.push(item.split(/\s+as\s+/)[0].trim());
    }
  }
  return names;
}

describe('demo framework coverage (issue #282 drift guard)', () => {
  const used = new Set<string>();
  for (const root of SCAN_ROOTS) {
    for (const file of collectFiles(root)) {
      for (const n of importedNames(readFileSync(file, 'utf8'))) used.add(n);
    }
  }
  for (const file of EXTRA_FILES) {
    for (const n of importedNames(readFileSync(file, 'utf8'))) used.add(n);
  }

  it('leaves no runtime export uncovered and unexplained', () => {
    const uncovered = Object.keys(hp)
      .filter((k) => !used.has(k))
      .filter((k) => !(k in ALLOWLIST))
      .sort();
    expect(uncovered).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const stale = Object.keys(ALLOWLIST).filter((k) => used.has(k));
    expect(stale).toEqual([]);
  });

  it('allowlists only real exports', () => {
    const ghosts = Object.keys(ALLOWLIST).filter((k) => !(k in hp));
    expect(ghosts).toEqual([]);
  });
});
