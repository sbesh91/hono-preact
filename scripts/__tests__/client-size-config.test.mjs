import { describe, it, expect } from 'vitest';
import { bucketForChunk, tableGzip } from '../client-size-config.mjs';
import {
  UI_CORE_MODULES,
  COMPONENT_MODULES,
  componentTableGzip,
} from '../client-size-config.mjs';

describe('bucketForChunk', () => {
  it('maps framework chunks to their feature buckets', () => {
    expect(bucketForChunk('guard-DJLFP2aQ.js')).toBe('guards');
    expect(bucketForChunk('loader-stub-BBx7s-oQ.js')).toBe('loaders');
    expect(bucketForChunk('loaders-Cb82m1UO.js')).toBe('loaders');
    expect(bucketForChunk('optimistic-ui-VlGv6y5e.js')).toBe('actions');
    expect(bucketForChunk('use-form-status-DYpR2niF.js')).toBe('actions');
    expect(bucketForChunk('view-transitions-CW4lqKHP.js')).toBe('transitions');
    expect(bucketForChunk('view-transition-name-DuHeharv.js')).toBe(
      'transitions'
    );
    expect(bucketForChunk('prefetch-B_HAewv0.js')).toBe('prefetch');
    expect(bucketForChunk('link-prefetch-D7NuYjWG.js')).toBe('prefetch');
    expect(bucketForChunk('sse-decoder-BsANPN5m.js')).toBe('streaming');
    expect(bucketForChunk('hono-middleware-CQF6FPxB.js')).toBe('middleware');
    expect(bucketForChunk('router-DTudL682.js')).toBe('core');
    expect(bucketForChunk('client.js')).toBe('core');
    expect(bucketForChunk('hoofd.module-BYkN5Afl.js')).toBe('vendor');
  });

  it('falls back to app for unmatched chunks', () => {
    expect(bucketForChunk('home-CGHL1ScW.js')).toBe('app');
    expect(bucketForChunk('DocsRoute-Du9xdgnk.js')).toBe('app');
  });

  it('does not let a short prefix swallow a sibling name', () => {
    // "loaders" must not be captured by a hypothetical "loader-stub" rule, and
    // "loading-states" must not be captured by "loader".
    expect(bucketForChunk('loading-states-xNzUIjIC.js')).toBe('core');
  });
});

describe('tableGzip', () => {
  it('returns total.gzip for the core bucket', () => {
    expect(
      tableGzip('core', { total: { gzip: 100 }, marginalOverCore: { gzip: 100 } })
    ).toBe(100);
  });

  it('returns marginalOverCore.gzip for non-core buckets', () => {
    expect(
      tableGzip('actions', { total: { gzip: 80 }, marginalOverCore: { gzip: 30 } })
    ).toBe(30);
  });
});

describe('Section C config', () => {
  it('declares non-empty shared ui-core modules', () => {
    expect(Array.isArray(UI_CORE_MODULES)).toBe(true);
    expect(UI_CORE_MODULES.length).toBeGreaterThan(0);
  });

  it('declares a dialog component entry', () => {
    expect(COMPONENT_MODULES.dialog).toBeDefined();
    expect(COMPONENT_MODULES.dialog.length).toBeGreaterThan(0);
  });

  it('componentTableGzip shows total for ui-core and marginal for components', () => {
    expect(
      componentTableGzip('ui-core', {
        total: { gzip: 500 },
        marginalOverUiCore: { gzip: 500 },
      })
    ).toBe(500);
    expect(
      componentTableGzip('dialog', {
        total: { gzip: 900 },
        marginalOverUiCore: { gzip: 400 },
      })
    ).toBe(400);
  });
});
