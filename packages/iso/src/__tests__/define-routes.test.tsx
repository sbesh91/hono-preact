import { describe, it, expect } from 'vitest';
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
