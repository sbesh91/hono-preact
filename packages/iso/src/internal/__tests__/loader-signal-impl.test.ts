// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createPhaseCell, derive } from '../loader-signal.js';

describe('signal-backed loader impl', () => {
  it('createPhaseCell holds and updates a value via its source', () => {
    const cell = createPhaseCell<{ n: number }>({ n: 0 });
    expect(cell.source.value).toEqual({ n: 0 });
    cell.set({ n: 5 });
    expect(cell.source.value).toEqual({ n: 5 });
  });

  it('derive projects reactively off the source', () => {
    const cell = createPhaseCell<{ n: number }>({ n: 2 });
    const doubled = derive(cell.source, (v) => v.n * 2);
    expect(doubled.value).toBe(4);
    cell.set({ n: 3 });
    expect(doubled.value).toBe(6);
  });
});
