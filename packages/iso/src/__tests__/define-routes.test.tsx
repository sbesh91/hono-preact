// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { ComponentType, VNode } from 'preact';
import { h } from 'preact';
import { useState, useContext } from 'preact/hooks';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { LocationProvider, Router } from 'preact-iso';
import {
  defineRoutes,
  Routes,
  type LayoutProps,
  type ServerRoute,
  type ViewProps,
} from '../define-routes.js';
import { RouteManifestContext } from '../internal/route-manifest.js';

const noopView = () => Promise.resolve({ default: () => null });
const noopLayout = () =>
  Promise.resolve({
    default: ({ children }: { children: unknown }) => children as never,
  });
const noopServer = () => Promise.resolve({});

describe('defineRoutes validation', () => {
  it('accepts a leaf route with view', () => {
    expect(() => defineRoutes([{ path: '/', view: noopView }])).not.toThrow();
  });

  it('accepts a leaf with view + server', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, server: noopServer }])
    ).not.toThrow();
  });

  it('accepts a layout with children', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/x',
          layout: noopLayout,
          children: [{ path: '', view: noopView }],
        },
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
      defineRoutes([
        { path: '/', view: noopView, layout: noopLayout, children: [] },
      ])
    ).toThrow(/cannot declare both `view` and `layout`/);
  });

  it('rejects view + children', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/',
          view: noopView,
          children: [{ path: 'x', view: noopView }],
        },
      ])
    ).toThrow(/`view` route cannot have `children`/);
  });

  it('rejects layout without children', () => {
    expect(() => defineRoutes([{ path: '/', layout: noopLayout }])).toThrow(
      /`layout` requires `children`/
    );
  });

  it('allows layout + server (layout can declare a server module)', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/',
          layout: noopLayout,
          server: noopServer,
          children: [{ path: '', view: noopView }],
        },
      ])
    ).not.toThrow();
  });

  it('rejects child path starting with `/`', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/x',
          layout: noopLayout,
          children: [{ path: '/y', view: noopView }],
        },
      ])
    ).toThrow(/child path must not start with `\/`/);
  });

  it('error messages include the offending path', () => {
    expect(() =>
      defineRoutes([{ path: '/broken', layout: noopLayout }])
    ).toThrow(/\/broken/);
  });

  it('accepts a path-grouping inside a layout when grandchildren are view leaves', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/movies',
          layout: noopLayout,
          children: [
            {
              path: 'admin',
              children: [
                { path: 'users', view: noopView },
                { path: 'posts', view: noopView },
              ],
            },
          ],
        },
      ])
    ).not.toThrow();
  });

  it('rejects a layout inside a path-grouping that is inside a layout group', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/movies',
          layout: noopLayout,
          children: [
            {
              path: 'admin',
              children: [
                {
                  path: 'users',
                  layout: noopLayout,
                  children: [{ path: '', view: noopView }],
                },
              ],
            },
          ],
        },
      ])
    ).toThrow(
      /path-grouping inside a layout group may only contain view leaves/
    );
  });

  it('rejects further path-grouping inside a path-grouping that is inside a layout group', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/movies',
          layout: noopLayout,
          children: [
            {
              path: 'admin',
              children: [
                { path: 'users', children: [{ path: 'list', view: noopView }] },
              ],
            },
          ],
        },
      ])
    ).toThrow(
      /path-grouping inside a layout group may only contain view leaves/
    );
  });

  it('still allows layouts inside top-level path-groupings (no restriction at top)', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/admin',
          children: [
            {
              path: 'users',
              layout: noopLayout,
              children: [{ path: '', view: noopView }],
            },
          ],
        },
      ])
    ).not.toThrow();
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

describe('serverRoutes ancestor walk', () => {
  it('captures server-bearing ancestors from the route-tree walk', () => {
    const layoutServer = () => Promise.resolve({ tag: 'layout' });
    const leafServer = () => Promise.resolve({ tag: 'leaf' });
    const m = defineRoutes([
      {
        path: '/admin',
        layout: noopLayout,
        server: layoutServer,
        children: [
          {
            path: 'users/:id',
            view: noopView,
            server: leafServer,
          },
        ],
      },
    ]);
    const leaf = m.serverRoutes.find((r) => r.path === '/admin/users/:id');
    expect(leaf).toBeDefined();
    // The leaf's ancestors stack contains the layout's server thunk -- the
    // real parent edge in the tree.
    expect(leaf!.ancestors).toEqual([layoutServer]);
    expect(leaf!.server).toBe(leafServer);
  });

  it('does NOT cross siblings that share a URL prefix', () => {
    // Mirrors the demo: /demo/projects and /demo/projects/:projectId/...
    // are siblings of the /demo path-grouping; neither layout has a
    // server. The nested leaf must NOT inherit /demo/projects's server as
    // an ancestor merely because the URL prefix matches.
    const projectsServer = () => Promise.resolve({ tag: 'projects' });
    const issueServer = () => Promise.resolve({ tag: 'issue' });
    const m = defineRoutes([
      {
        path: '/demo',
        children: [
          { path: 'projects', view: noopView, server: projectsServer },
          {
            path: 'projects/:projectId',
            layout: noopLayout,
            children: [
              {
                path: 'issues/:issueId',
                view: noopView,
                server: issueServer,
              },
            ],
          },
        ],
      },
    ]);
    const issue = m.serverRoutes.find(
      (r) => r.path === '/demo/projects/:projectId/issues/:issueId'
    );
    expect(issue).toBeDefined();
    // No server-bearing ancestor: neither /demo (path-grouping) nor
    // /demo/projects/:projectId (layout without server) emits a thunk.
    // /demo/projects is a SIBLING -- not an ancestor -- so its server
    // thunk is correctly absent.
    expect(issue!.ancestors).toEqual([]);
  });

  it('emits an empty ancestors array for top-level server-bearing routes', () => {
    const s = () => Promise.resolve({ tag: 's' });
    const m = defineRoutes([{ path: '/p', view: noopView, server: s }]);
    expect(m.serverRoutes).toHaveLength(1);
    expect(m.serverRoutes[0].ancestors).toEqual([]);
  });

  it('stacks multiple ancestors outer-first', () => {
    const outerS = () => Promise.resolve({ tag: 'outer' });
    const middleS = () => Promise.resolve({ tag: 'middle' });
    const innerS = () => Promise.resolve({ tag: 'inner' });
    const m = defineRoutes([
      {
        path: '/a',
        layout: noopLayout,
        server: outerS,
        children: [
          {
            path: 'b',
            layout: noopLayout,
            server: middleS,
            children: [{ path: 'c', view: noopView, server: innerS }],
          },
        ],
      },
    ]);
    const inner = m.serverRoutes.find((r) => r.path === '/a/b/c');
    expect(inner).toBeDefined();
    expect(inner!.ancestors).toEqual([outerS, middleS]);
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
});

describe('flatten — view-thunk identity sharing', () => {
  it('produces one component reference for two routes sharing the same view thunk', () => {
    const docsView = () => Promise.resolve({ default: () => null });
    const m = defineRoutes([
      { path: '/docs', view: docsView },
      { path: '/docs/*', view: docsView },
    ]);
    expect(m.flat).toHaveLength(2);
    expect(m.flat[0].component).toBe(m.flat[1].component);
  });

  it('produces distinct component references for distinct view thunks', () => {
    const m = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: () => null }) },
      { path: '/b', view: () => Promise.resolve({ default: () => null }) },
    ]);
    expect(m.flat[0].component).not.toBe(m.flat[1].component);
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
    // And the same VNode key, so preact's diff treats the bare and wildcard
    // registrations as the same child when navigation crosses between them.
    expect(m.flat[0].key).toBe(m.flat[1].key);
  });

  it('assigns distinct keys to FlatRoute entries with distinct components', () => {
    const m = defineRoutes([
      { path: '/', view: noopView },
      { path: '/about', view: () => Promise.resolve({ default: () => null }) },
    ]);
    expect(m.flat[0].key).not.toBe(m.flat[1].key);
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

  it('wires the coordinator load hooks (onLoadStart / onLoadEnd) onto the Router', () => {
    const m = defineRoutes([{ path: '/', view: noopView }]);
    const result = (
      Routes as unknown as (props: { routes: typeof m }) => VNode
    )({ routes: m });
    // Routes wraps the Router in a RouteManifestContext.Provider; the Router
    // is the Provider's sole child.
    const routerVNode = (result.props as { children: VNode }).children;
    expect(routerVNode.type).toBe(Router);
    const props = routerVNode.props as {
      onLoadStart?: unknown;
      onLoadEnd?: unknown;
    };
    expect(typeof props.onLoadStart).toBe('function');
    expect(typeof props.onLoadEnd).toBe('function');
  });

  it('provides the route manifest via RouteManifestContext', async () => {
    let seen: ReadonlyArray<ServerRoute> | null = null;
    const Probe = () => {
      seen = useContext(RouteManifestContext);
      return h('div', { 'data-testid': 'probe' }, 'ok');
    };
    const manifest = defineRoutes([
      {
        path: '/ctx',
        view: () => Promise.resolve({ default: Probe }),
        server: () => Promise.resolve({}),
      },
    ]);
    history.replaceState(null, '', '/ctx');
    const { findByTestId } = render(
      h(LocationProvider, null, h(Routes, { routes: manifest })) as VNode
    );
    await findByTestId('probe');
    expect(seen).toBe(manifest.serverRoutes);
  });
});

describe('layout integration: state survives intra-group navigation', () => {
  it('preserves layout-owned useState across /movies <-> /movies/:id', async () => {
    let layoutMounts = 0;
    const Layout: ComponentType<LayoutProps> = ({ children }) => {
      const [filter, setFilter] = useState(() => {
        layoutMounts++;
        return '';
      });
      return h(
        'div',
        null,
        h('input', {
          'data-testid': 'filter',
          value: filter,
          onInput: (e: Event) =>
            setFilter((e.currentTarget as HTMLInputElement).value),
        }),
        children as never
      );
    };

    const IndexView: ComponentType<ViewProps> = () =>
      h('a', { href: '/movies/123', 'data-testid': 'to-detail' }, 'detail');
    const DetailView: ComponentType<ViewProps> = () =>
      h('a', { href: '/movies', 'data-testid': 'to-index' }, 'back');

    const manifest = defineRoutes([
      {
        path: '/movies',
        layout: () => Promise.resolve({ default: Layout }),
        children: [
          { path: '', view: () => Promise.resolve({ default: IndexView }) },
          { path: ':id', view: () => Promise.resolve({ default: DetailView }) },
        ],
      },
    ]);

    history.replaceState(null, '', '/movies');
    const { findByTestId } = render(
      h(LocationProvider, null, h(Routes, { routes: manifest })) as VNode
    );

    const toDetail = (await findByTestId('to-detail')) as HTMLAnchorElement;
    const input = (await findByTestId('filter')) as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'hello' } });
    await waitFor(() => {
      expect(
        (document.querySelector('[data-testid=filter]') as HTMLInputElement)
          .value
      ).toBe('hello');
    });

    expect(layoutMounts).toBe(1);

    fireEvent.click(toDetail);
    await findByTestId('to-index');
    expect(layoutMounts).toBe(1);
    expect(((await findByTestId('filter')) as HTMLInputElement).value).toBe(
      'hello'
    );

    const toIndex = (await findByTestId('to-index')) as HTMLAnchorElement;
    fireEvent.click(toIndex);
    await findByTestId('to-detail');
    expect(layoutMounts).toBe(1);
    expect(((await findByTestId('filter')) as HTMLInputElement).value).toBe(
      'hello'
    );
  });
});
