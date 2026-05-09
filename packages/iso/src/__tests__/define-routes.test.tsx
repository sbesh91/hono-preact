import { describe, it, expect } from 'vitest';
import type { JSX } from 'preact';
import { defineRoutes } from '../define-routes.js';

const noopView = () => Promise.resolve({ default: () => null });
const noopLayout = () => Promise.resolve({ default: ({ children }: { children: unknown }) => children as never });
const noopServer = () => Promise.resolve({});

describe('defineRoutes validation', () => {
  it('accepts a leaf route with view', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView }])
    ).not.toThrow();
  });

  it('accepts a leaf with view + server', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, server: noopServer }])
    ).not.toThrow();
  });

  it('accepts a layout with children', () => {
    expect(() =>
      defineRoutes([
        { path: '/x', layout: noopLayout, children: [{ path: '', view: noopView }] },
      ])
    ).not.toThrow();
  });

  it('accepts a path-grouping route (children, no view, no layout)', () => {
    expect(() =>
      defineRoutes([
        { path: '/admin', children: [{ path: 'users', view: noopView }] },
      ])
    ).not.toThrow();
  });

  it('rejects view + layout', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, layout: noopLayout, children: [] }])
    ).toThrow(/cannot declare both `view` and `layout`/);
  });

  it('rejects view + children', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, children: [{ path: 'x', view: noopView }] }])
    ).toThrow(/`view` route cannot have `children`/);
  });

  it('rejects layout without children', () => {
    expect(() =>
      defineRoutes([{ path: '/', layout: noopLayout }])
    ).toThrow(/`layout` requires `children`/);
  });

  it('rejects layout + server', () => {
    expect(() =>
      defineRoutes([
        { path: '/', layout: noopLayout, server: noopServer, children: [{ path: '', view: noopView }] },
      ])
    ).toThrow(/`layout` cannot declare `server`/);
  });

  it('rejects child path starting with `/`', () => {
    expect(() =>
      defineRoutes([
        { path: '/x', layout: noopLayout, children: [{ path: '/y', view: noopView }] },
      ])
    ).toThrow(/child path must not start with `\/`/);
  });

  it('error messages include the offending path', () => {
    expect(() =>
      defineRoutes([{ path: '/broken', layout: noopLayout }])
    ).toThrow(/\/broken/);
  });
});

describe('serverImports collection', () => {
  it('collects server imports from leaves at any depth', () => {
    const s1 = () => Promise.resolve({ tag: 's1' });
    const s2 = () => Promise.resolve({ tag: 's2' });
    const m = defineRoutes([
      { path: '/', view: noopView, server: s1 },
      {
        path: '/x',
        layout: noopLayout,
        children: [{ path: 'y', view: noopView, server: s2 }],
      },
    ]);
    expect(m.serverImports).toHaveLength(2);
    expect(m.serverImports).toContain(s1);
    expect(m.serverImports).toContain(s2);
  });

  it('returns an empty list when no routes have server imports', () => {
    const m = defineRoutes([{ path: '/', view: noopView }]);
    expect(m.serverImports).toEqual([]);
  });
});

describe('flatten — flat (no layouts)', () => {
  it('emits one FlatRoute per leaf with full URL path', () => {
    const m = defineRoutes([
      { path: '/', view: noopView },
      { path: '/about', view: noopView },
      { path: '*', view: noopView },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/', '/about', '*']);
  });

  it('preserves source order in the flat list', () => {
    const m = defineRoutes([
      { path: '/b', view: noopView },
      { path: '/a', view: noopView },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/b', '/a']);
  });

  it('attaches fallback and errorFallback per leaf', () => {
    const fb = { type: 'p', props: {}, key: null } as unknown as JSX.Element;
    const m = defineRoutes([
      { path: '/', view: noopView, fallback: fb },
    ]);
    expect(m.flat[0].fallback).toBe(fb);
  });
});
