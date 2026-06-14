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

  it('groups component-area docs pages into the components bucket', () => {
    expect(bucketForChunk('dialog-BSsm66RQ.js')).toBe('components');
    expect(bucketForChunk('render-element-DMU4Us_-.js')).toBe('components');
    expect(bucketForChunk('use-controllable-state-BZJc3EUw.js')).toBe(
      'components'
    );
    expect(bucketForChunk('merge-refs-Dnaozq_v.js')).toBe('components');
    expect(bucketForChunk('components-C-lNE8AZ.js')).toBe('components');
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

describe('client size config: Popover + Tooltip', () => {
  it('measures popover and tooltip as components', () => {
    expect(COMPONENT_MODULES.popover).toEqual(['popover/index.js']);
    expect(COMPONENT_MODULES.tooltip).toEqual(['tooltip/index.js']);
  });

  it('buckets the new component doc chunks under components', () => {
    expect(bucketForChunk('popover-AbC123.js')).toBe('components');
    expect(bucketForChunk('tooltip-AbC123.js')).toBe('components');
    expect(bucketForChunk('use-position-AbC123.js')).toBe('components');
    expect(bucketForChunk('use-dismiss-AbC123.js')).toBe('components');
  });
});
