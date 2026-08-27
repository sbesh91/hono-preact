import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as publicEntry from '../index.js';
import * as runtime from '../internal-runtime.js';

const INTERNALIZED_FACTORIES = [
  'routeServerModules',
  'makePageUseResolver',
  'makePageActionResolvers',
] as const;

const INTERNALIZED_HANDLERS = ['loadersHandler', 'pageActionsHandler'] as const;

describe('server boundary', () => {
  it('exposes createServerEntry on /internal/runtime', () => {
    expect(typeof runtime.createServerEntry).toBe('function');
  });

  it('does not re-surface the resolver factories from /internal/runtime', () => {
    for (const name of INTERNALIZED_FACTORIES) {
      expect(name in runtime).toBe(false);
    }
  });

  it('surfaces the SSR + context public API on the public entry', () => {
    expect(typeof publicEntry.renderPage).toBe('function');
    expect(typeof publicEntry.HonoContext).toBe('function');
    expect(typeof publicEntry.useHonoContext).toBe('function');
  });

  it('does not surface the internalized handlers from the public entry', () => {
    for (const name of INTERNALIZED_HANDLERS) {
      expect(name in publicEntry).toBe(false);
    }
  });

  it('does not surface the internalized factories from the public entry', () => {
    for (const name of INTERNALIZED_FACTORIES) {
      expect(name in publicEntry).toBe(false);
    }
  });

  // Exact-set door tests (#324c). The presence/absence assertions above catch a
  // deleted or newly-leaked export, but a RENAME slips through both: the old
  // name stops being asserted and the new one was never listed. Pinning the
  // whole key set is what makes a rename fail here, in the fast unit tier,
  // rather than only in the gated workerd runs.
  it('exports exactly the documented set from /internal/runtime', () => {
    const expected = new Set([
      // The generated server entry's sole import (serverEntryPlugin codegen).
      'createServerEntry',
      // The modulepreload artifact reader seam, installed by the adapter entry.
      'installPreloadModules',
      // Dev-only global stylesheet seam, installed by the generated core app.
      'installDevGlobalCss',
    ]);
    expect([...new Set(Object.keys(runtime))].sort()).toEqual(
      [...expected].sort()
    );
  });

  it('exports exactly the documented set from the public entry', () => {
    const expected = new Set(['renderPage', 'HonoContext', 'useHonoContext']);
    expect([...new Set(Object.keys(publicEntry))].sort()).toEqual(
      [...expected].sort()
    );
  });
});

// The Cloudflare door cannot be imported here: `./cf/realtime-do.js` pulls
// `cloudflare:workers`, which resolves only in workerd (see the file header on
// internal-cloudflare.ts). Its only other coverage is the gated
// integration/smoke tiers, so a rename there is invisible to the fast tier.
// Parsing the door's own source is what closes that gap without a workerd pool.
describe('cloudflare door', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../internal-cloudflare.ts', import.meta.url)),
    'utf8'
  );

  function parseExportedNames(src: string): string[] {
    const names: string[] = [];
    for (const block of src.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
      for (const raw of block[1].split(',')) {
        const spec = raw.trim();
        if (spec === '') continue;
        // `a as b` exports under `b`; `type X` is erased at runtime.
        const exported = spec
          .split(/\s+as\s+/)
          .pop()!
          .trim();
        if (exported.startsWith('type ')) continue;
        names.push(exported);
      }
    }
    return names;
  }

  it('exports exactly the documented set', () => {
    const expected = new Set([
      // The Durable Object class + its connector/state factories.
      'HonoPreactRealtimeDO',
      'makeCfForwardConnector',
      'makeDOConnState',
      // Room registry seam (install/read/test-reset) + its builder.
      'installRoomRegistry',
      'getRoomRegistry',
      '__resetRoomRegistryForTesting',
      'buildRoomRegistry',
      // Socket registry seam + its builder.
      'installSocketRegistry',
      'getSocketRegistry',
      '__resetSocketRegistryForTesting',
      'buildSocketRegistry',
      // Realtime pub/sub backend + its ALS runtime accessors.
      'makeCfPubSubBackend',
      'runWithRealtimeRuntime',
      'getRealtimeRuntime',
      // Platform seams the generated worker entry installs.
      'makeAssetsPreloadReader',
      'makeCfWebSocketUpgrader',
    ]);
    const actual = parseExportedNames(source);
    expect(actual).toHaveLength(new Set(actual).size);
    expect([...new Set(actual)].sort()).toEqual([...expected].sort());
  });

  it('parses a representative export block', () => {
    // Mutation guard: proves the assertion above fails on a rename rather than
    // passing vacuously on an empty parse.
    expect(
      parseExportedNames("export { a, b as c, type D } from './x.js';")
    ).toEqual(['a', 'c']);
  });
});
