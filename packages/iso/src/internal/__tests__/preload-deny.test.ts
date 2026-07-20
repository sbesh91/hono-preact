// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getPreloadedDeny, deletePreloadedDeny } from '../preload.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('getPreloadedDeny', () => {
  it('reads a present deny marker', () => {
    const el = document.createElement('section');
    el.id = 'L1';
    el.dataset.loaderDeny = JSON.stringify({ message: 'nope' });
    document.body.appendChild(el);
    expect(getPreloadedDeny('L1')).toEqual({ present: true, message: 'nope' });
  });

  it('reports absent when the element or attribute is missing', () => {
    expect(getPreloadedDeny('missing')).toEqual({ present: false });
    const el = document.createElement('section');
    el.id = 'L2';
    document.body.appendChild(el);
    expect(getPreloadedDeny('L2')).toEqual({ present: false });
  });

  it('reports absent on malformed JSON', () => {
    const el = document.createElement('section');
    el.id = 'L3';
    el.dataset.loaderDeny = '{not json';
    document.body.appendChild(el);
    expect(getPreloadedDeny('L3')).toEqual({ present: false });
  });

  it('deletePreloadedDeny clears the attribute', () => {
    const el = document.createElement('section');
    el.id = 'L4';
    el.dataset.loaderDeny = JSON.stringify({ message: 'x' });
    document.body.appendChild(el);
    deletePreloadedDeny('L4');
    expect('loaderDeny' in el.dataset).toBe(false);
  });
});
