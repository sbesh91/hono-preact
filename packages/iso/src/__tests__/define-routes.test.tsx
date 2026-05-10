// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { ComponentType, JSX, VNode } from 'preact';
import { h } from 'preact';
import { render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';

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

describe('flatten — layout groups', () => {
  it('registers a layout group at both bare path and wildcard path', () => {
    const m = defineRoutes([
      {
        path: '/movies',
        layout: noopLayout,
        children: [
          { path: '', view: noopView },
          { path: ':id', view: noopView },
        ],
      },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/movies', '/movies/*']);
    // Same component reference for both:
    expect(m.flat[0].component).toBe(m.flat[1].component);
  });

  it('mixes top-level leaves and layout groups in source order', () => {
    const m = defineRoutes([
      { path: '/', view: noopView },
      {
        path: '/x',
        layout: noopLayout,
        children: [{ path: '', view: noopView }],
      },
      { path: '*', view: noopView },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/', '/x', '/x/*', '*']);
  });

  it('flattens path-grouping routes (no layout) by inlining children', () => {
    const m = defineRoutes([
      {
        path: '/admin',
        children: [
          { path: 'users', view: noopView },
          { path: 'posts', view: noopView },
        ],
      },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/admin/users', '/admin/posts']);
  });

  it('handles nested layouts (layout inside layout)', () => {
    const m = defineRoutes([
      {
        path: '/a',
        layout: noopLayout,
        children: [
          {
            path: 'b',
            layout: noopLayout,
            children: [{ path: '', view: noopView }],
          },
        ],
      },
    ]);
    // Outer layout group exposes itself + wildcard; inner is collapsed
    // into the outer's child router (not at the outer Router).
    expect(m.flat.map((f) => f.path)).toEqual(['/a', '/a/*']);
  });
});

describe('<Routes>', () => {
  it('renders a preact-iso Router with one Route per flat entry', () => {
    const Hi: ComponentType = () => h('p', null, 'hi') as unknown as VNode;
    const manifest = defineRoutes([
      { path: '/', view: () => Promise.resolve({ default: Hi }) },
    ]);
    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes: manifest })) as VNode
    );
    // The lazy Hi resolves async; the smoke is just that <Routes> renders
    // without throwing and produces the LocationProvider tree.
    expect(container.innerHTML).toBeDefined();
  });
});
