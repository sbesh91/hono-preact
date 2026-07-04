import { describe, it, expect } from 'vitest';
import {
  CORE_MODULES,
  FEATURE_MODULES,
  UI_CORE_MODULES,
  COMPONENT_MODULES,
  EXTERNAL,
} from '../size-probe-config.mjs';

describe('size-probe-config manifests', () => {
  it('declares non-empty core and feature module lists', () => {
    expect(CORE_MODULES.length).toBeGreaterThan(0);
    expect(Object.keys(FEATURE_MODULES)).toContain('loaders');
    expect(FEATURE_MODULES.loaders.length).toBeGreaterThan(0);
    expect(Object.keys(FEATURE_MODULES)).toContain('middleware');
  });

  it('covers the always-on runtime and realtime, which ship with zero opt-in', () => {
    // These two buckets exist because they were measured NOWHERE before: the
    // client entry installs the runtime unconditionally on every route, and
    // realtime was absent from the manifest entirely. Losing either row
    // re-opens a silent size-regression blind spot (REVIEW.md §5).
    expect(FEATURE_MODULES.runtime?.length).toBeGreaterThan(0);
    expect(FEATURE_MODULES.realtime?.length).toBeGreaterThan(0);
  });

  it('attributes outcomes to core, not actions (it ships on every route)', () => {
    expect(CORE_MODULES).toContain('outcomes.js');
    expect(FEATURE_MODULES.actions).not.toContain('outcomes.js');
  });

  it('declares ui-core and component module lists', () => {
    expect(UI_CORE_MODULES.length).toBeGreaterThan(0);
    expect(COMPONENT_MODULES.dialog).toEqual(['dialog/index.js']);
    expect(COMPONENT_MODULES.popover).toEqual(['popover/index.js']);
  });

  it('keeps the shared positioner/dismiss cluster in ui-core so component rows stay additive', () => {
    // Omitting any of these re-counts them in every component that uses them,
    // the bug that made the popover family over-state by up to ~3.7x.
    for (const shared of [
      'positioner.js',
      'use-dismiss.js',
      'list-navigation.js',
    ]) {
      expect(UI_CORE_MODULES).toContain(shared);
    }
  });

  it('lists preact and hono as external peers', () => {
    expect(EXTERNAL).toContain('preact');
    expect(EXTERNAL).toContain('hono');
  });
});
