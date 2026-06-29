// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { ComponentType, VNode } from 'preact';
import { Route } from 'preact-iso';
import {
  buildInnerRoutes,
  type RouteDef,
  type ViewProps,
} from '../define-routes.js';
import { defineServerMiddleware } from '../define-middleware.js';

const noopView = () => Promise.resolve({ default: () => null });
const noopLayout = () =>
  Promise.resolve({
    default: ({ children }: { children: unknown }) => children as never,
  });
const mw = defineServerMiddleware(async (_ctx, next) => {
  await next();
});

const freshCache = () => new Map<unknown, ComponentType<ViewProps>>();
const paths = (nodes: VNode<any>[]) => nodes.map((n) => n.props.path);
const components = (nodes: VNode<any>[]) =>
  nodes.map((n) => n.props.component as ComponentType);
const displayName = (c: ComponentType) => String(c.displayName ?? '');

// buildInnerRoutes builds the <Route> children of a layout group's INNER
// Router. Paths are relative to that mount point (no absolute prefix), unlike
// the absolute paths flattenTree emits for the top-level Router.
describe('buildInnerRoutes', () => {
  it('emits one Route per view leaf at its relative path, in source order', () => {
    const nodes = buildInnerRoutes(
      [
        { path: '', view: noopView },
        { path: ':id', view: noopView },
      ],
      freshCache()
    );
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.type === Route)).toBe(true);
    expect(paths(nodes)).toEqual(['', ':id']);
  });

  it('emits a layout group as a bare + wildcard pair sharing one component', () => {
    const nodes = buildInnerRoutes(
      [
        {
          path: 'settings',
          layout: noopLayout,
          children: [{ path: '', view: noopView }],
        },
      ],
      freshCache()
    );
    expect(paths(nodes)).toEqual(['settings', 'settings/*']);
    // Shared component reference is what lets preact-iso treat a crossing
    // between the bare and wildcard registrations as one child, not a remount.
    expect(nodes[0].props.component).toBe(nodes[1].props.component);
  });

  it('inlines a bare grouping, prefixing grandchild paths with the group segment', () => {
    const nodes = buildInnerRoutes(
      [
        {
          path: 'admin',
          children: [
            { path: 'users', view: noopView },
            { path: 'posts', view: noopView },
          ],
        },
      ],
      freshCache()
    );
    expect(paths(nodes)).toEqual(['admin/users', 'admin/posts']);
  });

  it('prefixes a layout group nested inside a bare grouping', () => {
    const nodes = buildInnerRoutes(
      [
        {
          path: 'admin',
          children: [
            {
              path: 'team',
              layout: noopLayout,
              children: [{ path: '', view: noopView }],
            },
          ],
        },
      ],
      freshCache()
    );
    expect(paths(nodes)).toEqual(['admin/team', 'admin/team/*']);
    expect(nodes[0].props.component).toBe(nodes[1].props.component);
  });

  it('prefixes through two levels of nested bare groupings', () => {
    const nodes = buildInnerRoutes(
      [
        {
          path: 'a',
          children: [{ path: 'b', children: [{ path: 'c', view: noopView }] }],
        },
      ],
      freshCache()
    );
    expect(paths(nodes)).toEqual(['a/b/c']);
  });

  // An empty-path index leaf under a bare grouping joins to the bare group
  // segment with no trailing slash (`admin`, not `admin/`), matching the path
  // `flattenTree` emits for the same shape at the top level. The walk threads
  // one `joinRoutePath` for both, so flat and inner paths stay consistent.
  it('joins an empty-path index leaf to the grouping segment without a trailing slash', () => {
    const nodes = buildInnerRoutes(
      [
        {
          path: 'admin',
          children: [
            { path: '', view: noopView },
            { path: 'users', view: noopView },
          ],
        },
      ],
      freshCache()
    );
    expect(paths(nodes)).toEqual(['admin', 'admin/users']);
  });

  it('collapses an empty intermediate grouping without a doubled slash', () => {
    const nodes = buildInnerRoutes(
      [
        {
          path: 'a',
          children: [{ path: '', children: [{ path: 'x', view: noopView }] }],
        },
      ],
      freshCache()
    );
    expect(paths(nodes)).toEqual(['a/x']);
  });

  it('shares one component reference across leaves that reuse a view thunk', () => {
    const shared = () => Promise.resolve({ default: () => null });
    const nodes = buildInnerRoutes(
      [
        { path: 'a', view: shared },
        { path: 'b', view: shared },
      ],
      freshCache()
    );
    expect(nodes[0].props.component).toBe(nodes[1].props.component);
  });

  it('wraps a leaf in a page-middleware guard when pendingUse is non-empty', () => {
    const guarded = buildInnerRoutes(
      [{ path: '', view: noopView }],
      freshCache(),
      [mw]
    );
    const plain = buildInnerRoutes(
      [{ path: '', view: noopView }],
      freshCache()
    );
    expect(displayName(components(guarded)[0])).toMatch(/^Guarded\(/);
    expect(displayName(components(plain)[0])).not.toMatch(/^Guarded\(/);
  });

  it('carries a bare grouping use down to its inlined grandchildren', () => {
    const nodes = buildInnerRoutes(
      [
        {
          path: 'area',
          use: [mw],
          children: [{ path: 'x', view: noopView }],
        },
      ],
      freshCache()
    );
    expect(paths(nodes)).toEqual(['area/x']);
    expect(displayName(components(nodes)[0])).toMatch(/^Guarded\(/);
  });

  it('returns an empty list for an empty children array', () => {
    const nodes = buildInnerRoutes([] as readonly RouteDef[], freshCache());
    expect(nodes).toEqual([]);
  });
});
