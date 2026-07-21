import { describe, it, expect } from 'vitest';
import * as internal from '../internal.js';

describe('@hono-preact/iso/internal', () => {
  it('exposes the granular composition primitives', () => {
    expect(typeof internal.Loader).toBe('function');
    expect(typeof internal.Envelope).toBe('function');
    expect(typeof internal.RouteBoundary).toBe('function');
    expect(typeof internal.OptimisticOverlay).toBe('function');
    expect(typeof internal.PageMiddlewareHost).toBe('function');
  });

  it('exposes the context objects for advanced consumers', () => {
    expect(internal.LoaderIdContext).toBeDefined();
    expect(internal.LoaderDataContext).toBeDefined();
    expect(internal.ReloadContext).toBeDefined();
    expect(internal.HonoRequestContext).toBeDefined();
  });

  it('exposes the SSR + low-level helpers', () => {
    expect(typeof internal.getPreloadedData).toBe('function');
    expect(typeof internal.deletePreloadedData).toBe('function');
    expect(typeof internal.runRequestScope).toBe('function');
    expect(typeof internal.wrapPromise).toBe('function');
    expect(typeof internal.dispatchServer).toBe('function');
    expect(typeof internal.dispatchClient).toBe('function');
    expect(typeof internal.partitionUse).toBe('function');
    expect(typeof internal.isMiddleware).toBe('function');
    expect(typeof internal.isObserver).toBe('function');
  });
});
