// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as ui from '../index.js';

describe('@hono-preact/ui exports', () => {
  it('exposes the new machinery primitives', () => {
    expect(typeof ui.usePosition).toBe('function');
    expect(typeof ui.useDismiss).toBe('function');
    expect(typeof ui.useFocusReturn).toBe('function');
    expect(typeof ui.useSafeArea).toBe('function');
    expect(typeof ui.placementFor).toBe('function');
  });
});
