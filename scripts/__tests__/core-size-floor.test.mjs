import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleSize, entryFor } from '../measure-framework-size.mjs';
import {
  CORE_MODULES,
  FEATURE_MODULES,
  EXTERNAL,
} from '../size-probe-config.mjs';

// The always-loaded floor: what EVERY route ships, whatever features it uses.
// This is the property the signals migration has to keep honest. `@preact/signals`
// is a hard dependency of @hono-preact/iso and is re-exported from the public
// barrel, so nothing in the type system or the module graph stops it from being
// pulled into a core module by an ordinary-looking import. If that happens the
// cost is not a rounding error: it is the whole reactive runtime, on every page,
// including pages that never read a signal.
//
// So the guard is a measurement, not a grep. It bundles the same manifests the
// PR size comment uses, with @preact/signals COUNTED rather than treated as an
// already-shipped peer, and holds the total under a budget.
//
// TWO manifests, not one. `CORE_MODULES` is not the whole always-loaded floor:
// size-probe-config.mjs documents `FEATURE_MODULES.runtime` as the set "every
// route pays on top of core". The module-graph guard this replaced scanned all
// ~90 source modules, so it would have caught a signal import landing in
// `boot-client.ts`; a budget over CORE_MODULES alone cannot see that file at
// all. Nothing in `runtime` imports signals today, and this is what keeps it
// that way.
const ROOT = resolve(join(import.meta.dirname, '..', '..'));
const ISO_DIST = join(ROOT, 'packages/iso/dist');
// esbuild resolves the synthetic entry's bare specifiers from here; the package
// under measurement is where @preact/signals is actually installed.
const RESOLVE_DIR = join(ROOT, 'packages/iso');

// Everything a consumer already ships EXCEPT @preact/signals, whose bytes are
// the thing being watched.
const EXTERNAL_COUNTING_SIGNALS = EXTERNAL.filter(
  (e) => !e.startsWith('@preact/signals')
);

// Budget, gzip bytes. Measured at 5,495 B when this was written, with
// @preact/signals reachable from no core module. The headroom (~700 B) absorbs
// ordinary churn in the eight core modules; the ~3,300 B that @preact/signals
// would add blows straight through it.
//
// Raising this is a deliberate act, not a rebase chore: put the new measured
// number and the reason in the commit message. If it is being raised because
// signals reached core, the fix is the import, not the budget.
const CORE_BUDGET_BYTES = 6_200;
// core + `FEATURE_MODULES.runtime`, the real always-loaded floor. Measured at
// 7,961 B; the headroom matches CORE_BUDGET's (a few hundred bytes for ordinary
// growth, far under the ~3,300 B a signals import would add).
const FLOOR_BUDGET_BYTES = 8_400;

describe('always-loaded core size floor', () => {
  it('has a built dist to measure', () => {
    // Without this the entry filter silently drops every module and the budget
    // assertion below passes on an empty bundle. Run the framework build first
    // (step 1 of the pre-push sequence in CLAUDE.md).
    expect(
      existsSync(join(ISO_DIST, CORE_MODULES[0])),
      `missing ${join(ISO_DIST, CORE_MODULES[0])}; build packages/iso first`
    ).toBe(true);
  });

  it('keeps core under budget with @preact/signals counted', async () => {
    // `.eager` is the right number for a floor: the floor is defined as what
    // every route ships up front. No core module uses a dynamic import today,
    // so eager equals the old concatenated total and the budget is unchanged.
    const core = await bundleSize(
      entryFor(CORE_MODULES, ISO_DIST),
      RESOLVE_DIR,
      EXTERNAL_COUNTING_SIGNALS
    );
    expect(core.eager).toBeLessThanOrEqual(CORE_BUDGET_BYTES);
  });

  it('keeps the runtime bucket under budget too', async () => {
    // `boot-client.js` and friends ship on every route alongside core, so a
    // signal import there is the same failure as one in core. Budgeted
    // together rather than separately: what a route actually pays is the sum,
    // and splitting the budget would let one grow while the other shrank.
    const floor = await bundleSize(
      entryFor([...CORE_MODULES, ...FEATURE_MODULES.runtime], ISO_DIST),
      RESOLVE_DIR,
      EXTERNAL_COUNTING_SIGNALS
    );
    expect(floor.eager).toBeLessThanOrEqual(FLOOR_BUDGET_BYTES);
  });

  it('would fail if @preact/signals reached the runtime bucket', async () => {
    const floorWithSignals = await bundleSize(
      `${entryFor([...CORE_MODULES, ...FEATURE_MODULES.runtime], ISO_DIST)}\nexport * as signals from '@preact/signals';`,
      RESOLVE_DIR,
      EXTERNAL_COUNTING_SIGNALS
    );
    expect(floorWithSignals.eager).toBeGreaterThan(FLOOR_BUDGET_BYTES);
  });

  it('would fail if @preact/signals reached core', async () => {
    // The budget is only a guard if it actually discriminates. This measures the
    // failure it exists to catch -- core plus the signals runtime -- and asserts
    // it lands OVER the budget. Without this, shrinking core or inflating the
    // budget could leave a green test that no longer catches anything.
    const coreWithSignals = await bundleSize(
      `${entryFor(CORE_MODULES, ISO_DIST)}\nexport * as signals from '@preact/signals';`,
      RESOLVE_DIR,
      EXTERNAL_COUNTING_SIGNALS
    );
    expect(coreWithSignals.eager).toBeGreaterThan(CORE_BUDGET_BYTES);
  });
});
