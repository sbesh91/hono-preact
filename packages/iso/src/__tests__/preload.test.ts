// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getPreloadedData, deletePreloadedData } from '../preload.js';
import { env } from '../is-browser.js';

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
  it('returns null when not in browser', () => {
    env.current = 'server';
    makeElement('test-id', '{"msg":"hi"}');
    expect(getPreloadedData('test-id')).toBeNull();
  });

  it('returns null when the element does not exist', () => {
    expect(getPreloadedData('no-such-id')).toBeNull();
  });

  it('returns null when the element has no data-loader attribute', () => {
    makeElement('test-id');
    expect(getPreloadedData('test-id')).toBeNull();
  });

  it('returns the parsed object when data-loader contains valid JSON', () => {
    makeElement('test-id', '{"msg":"hello"}');
    expect(getPreloadedData('test-id')).toEqual({ msg: 'hello' });
  });

  it('returns an empty object when data-loader is "{}"', () => {
    makeElement('test-id', '{}');
    expect(getPreloadedData('test-id')).toEqual({});
  });

  it('returns null when data-loader contains malformed JSON', () => {
    makeElement('test-id', '{not valid json}');
    expect(getPreloadedData('test-id')).toBeNull();
  });

  it('deletes data-loader from the element after reading (finally block)', () => {
    const el = makeElement('test-id', '{"msg":"hi"}');
    getPreloadedData('test-id');
    expect(el.dataset.loader).toBeUndefined();
  });

  it('deletes data-loader even when JSON parse throws', () => {
    const el = makeElement('test-id', '{bad}');
    getPreloadedData('test-id');
    expect(el.dataset.loader).toBeUndefined();
  });

  it('returns null on a second call to the same id (data was deleted on first call)', () => {
    makeElement('test-id', '{"msg":"hi"}');
    getPreloadedData('test-id');
    expect(getPreloadedData('test-id')).toBeNull();
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
