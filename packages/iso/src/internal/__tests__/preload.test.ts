// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getPreloadedData, deletePreloadedData } from '../preload.js';
import { env } from '../../is-browser.js';

function makeElement(id: string, loaderJson?: string): HTMLElement {
  const el = document.createElement('section');
  el.id = id;
  if (loaderJson !== undefined) {
    el.dataset.loader = loaderJson;
  }
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  env.current = 'browser';
});

describe('getPreloadedData', () => {
  // Returns a present/absent discriminant: `{ present: false }` for "no preload"
  // and `{ present: true, value }` for a baked payload, so a baked `null` is
  // PRESENT, not collapsed into absence.
  it('returns absent when not in browser', () => {
    env.current = 'server';
    makeElement('test-id', '{"msg":"hi"}');
    expect(getPreloadedData('test-id')).toEqual({ present: false });
  });

  it('returns absent when the element does not exist', () => {
    expect(getPreloadedData('no-such-id')).toEqual({ present: false });
  });

  it('returns absent when the element has no data-loader attribute', () => {
    makeElement('test-id');
    expect(getPreloadedData('test-id')).toEqual({ present: false });
  });

  it('returns the parsed object as a present value when data-loader is valid JSON', () => {
    makeElement('test-id', '{"msg":"hello"}');
    expect(getPreloadedData('test-id')).toEqual({
      present: true,
      value: { msg: 'hello' },
    });
  });

  it('returns a present empty object when data-loader is "{}"', () => {
    makeElement('test-id', '{}');
    expect(getPreloadedData('test-id')).toEqual({ present: true, value: {} });
  });

  it('returns a PRESENT value of null when data-loader is "null" (not absent)', () => {
    // The core preload fix: a loader that SSR'd `null` is present with value
    // `null`, distinct from "no preload". The old `T | null` return collapsed
    // the two and refetched on hydration.
    makeElement('test-id', 'null');
    expect(getPreloadedData('test-id')).toEqual({ present: true, value: null });
  });

  it('returns absent when data-loader contains malformed JSON', () => {
    makeElement('test-id', '{not valid json}');
    expect(getPreloadedData('test-id')).toEqual({ present: false });
  });

  it('does NOT delete data-loader on read (pure read; caller schedules delete in useEffect)', () => {
    const el = makeElement('test-id', '{"msg":"hi"}');
    getPreloadedData('test-id');
    // Previously this function mutated the DOM during render via a `finally`
    // block. Now reading is pure; cleanup is the caller's responsibility
    // (use-loader-runner.tsx schedules a `deletePreloadedData` in useEffect
    // after commit). Tests that previously asserted the side effect are
    // inverted: they now lock in the purity guarantee.
    expect(el.dataset.loader).toBe('{"msg":"hi"}');
  });

  it('returns the same value on a second call (read is idempotent)', () => {
    makeElement('test-id', '{"msg":"hi"}');
    expect(getPreloadedData('test-id')).toEqual({
      present: true,
      value: { msg: 'hi' },
    });
    expect(getPreloadedData('test-id')).toEqual({
      present: true,
      value: { msg: 'hi' },
    });
  });
});

describe('deletePreloadedData', () => {
  it('removes data-loader from an existing element', () => {
    const el = makeElement('test-id', '{"x":1}');
    deletePreloadedData('test-id');
    expect(el.dataset.loader).toBeUndefined();
  });

  it('does nothing when the element does not exist', () => {
    expect(() => deletePreloadedData('no-such-id')).not.toThrow();
  });
});
