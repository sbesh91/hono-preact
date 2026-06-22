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

  it('declares ui-core and component module lists', () => {
    expect(UI_CORE_MODULES.length).toBeGreaterThan(0);
    expect(COMPONENT_MODULES.dialog).toEqual(['dialog/index.js']);
    expect(COMPONENT_MODULES.popover).toEqual(['popover/index.js']);
  });

  it('lists preact and hono as external peers', () => {
    expect(EXTERNAL).toContain('preact');
    expect(EXTERNAL).toContain('hono');
  });
});
