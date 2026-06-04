// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { placementFor, sideAlignFromPlacement } from '../use-position.js';

describe('placement helpers', () => {
  it('maps center alignment to the bare side', () => {
    expect(placementFor('bottom', 'center')).toBe('bottom');
    expect(placementFor('top', 'center')).toBe('top');
  });

  it('maps start/end to floating-ui suffixes', () => {
    expect(placementFor('bottom', 'start')).toBe('bottom-start');
    expect(placementFor('right', 'end')).toBe('right-end');
  });

  it('round-trips a resolved placement back to side/align', () => {
    expect(sideAlignFromPlacement('bottom')).toEqual({
      side: 'bottom',
      align: 'center',
    });
    expect(sideAlignFromPlacement('left-start')).toEqual({
      side: 'left',
      align: 'start',
    });
    expect(sideAlignFromPlacement('top-end')).toEqual({
      side: 'top',
      align: 'end',
    });
  });
});
