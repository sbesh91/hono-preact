// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  getLoaderReactiveImpl,
  registerLoaderReactiveImpl,
} from '../reactive.js';
import { installLoaderSignals } from '../../signals.js';

afterEach(() => registerLoaderReactiveImpl(null));

describe('signal-backed loader impl', () => {
  it('registers on install', () => {
    installLoaderSignals();
    expect(getLoaderReactiveImpl()).not.toBeNull();
  });

  it('createPhaseCell holds and updates a value via its source', () => {
    installLoaderSignals();
    const impl = getLoaderReactiveImpl()!;
    const cell = impl.createPhaseCell<{ n: number }>({ n: 0 });
    expect(cell.source.value).toEqual({ n: 0 });
    cell.set({ n: 5 });
    expect(cell.source.value).toEqual({ n: 5 });
  });

  it('derive projects reactively off the source', () => {
    installLoaderSignals();
    const impl = getLoaderReactiveImpl()!;
    const cell = impl.createPhaseCell<{ n: number }>({ n: 2 });
    const doubled = impl.derive(cell.source, (v) => v.n * 2);
    expect(doubled.value).toBe(4);
    cell.set({ n: 3 });
    expect(doubled.value).toBe(6);
  });
});
