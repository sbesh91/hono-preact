import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  uncoveredClientModules,
  coveredModules,
  topLevelModules,
  sharedUiModules,
} from '../size-manifest-coverage.mjs';
import * as config from '../size-probe-config.mjs';

const ISO = resolve('packages/iso/dist');
const UI = resolve('packages/ui/dist');

describe('size manifest completeness', () => {
  it('attributes every client module to a bucket (or an explicit exclusion)', () => {
    // A top-level dist module that ships to a client but is in no bucket is
    // measured by no size-comment row: exactly the drift that let realtime and
    // use-prefetch go unmeasured. To fix a failure, bucket the listed module(s)
    // in size-probe-config.mjs, or add them to EXCLUDED_MODULES with a reason
    // if they are server-only / barrels / type-only.
    expect(uncoveredClientModules(ISO)).toEqual([]);
  });

  it('keeps EXCLUDED_MODULES free of stale or redundant entries', () => {
    const covered = coveredModules(ISO);
    const top = new Set(topLevelModules(ISO));
    for (const m of config.EXCLUDED_MODULES ?? []) {
      expect(top.has(m), `${m} excluded but not a real top-level module`).toBe(
        true
      );
      expect(
        covered.has(m),
        `${m} excluded but already covered by a bucket`
      ).toBe(false);
    }
  });

  it('keeps every module shared by >=3 UI components in ui-core', () => {
    // A shared module missing from ui-core is re-counted in each component that
    // uses it (the popover-family over-count PR1 fixed). This guards it.
    for (const m of sharedUiModules(UI, 3)) {
      expect(
        config.UI_CORE_MODULES,
        `ui-core missing shared module ${m}`
      ).toContain(m);
    }
  });
});
