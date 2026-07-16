// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import type { ComponentType, VNode } from 'preact';
import { h } from 'preact';
import { useState, useContext } from 'preact/hooks';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import {
  defineRoutes,
  Routes,
  type LayoutProps,
  type ServerRoute,
  type ViewProps,
} from '../define-routes.js';
import { RouteManifestContext } from '../internal/route-manifest.js';
import * as routeChange from '../internal/route-change.js';
import { defineServerMiddleware } from '../define-middleware.js';

const noopView = () => Promise.resolve({ default: () => null });
const noopLayout = () =>
  Promise.resolve({
    default: ({ children }: { children: unknown }) => children as never,
  });
const noopServer = () => Promise.resolve({});

const mw = defineServerMiddleware(async (_ctx, next) => {
  await next();
});

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

  it('accepts a layout inside a path-grouping that is inside a layout group', () => {
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
    ).not.toThrow();
  });

  it('accepts further path-grouping inside a path-grouping that is inside a layout group', () => {
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
    ).not.toThrow();
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

  it('accepts `use` on a leaf node', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, use: [mw] }])
    ).not.toThrow();
  });

  it('validation accepts `use` on a bare grouping with a nested layout (render support lands in task 3)', () => {
    // validate() no longer rejects this shape; buildInnerRoutes render support comes in task 3.
    expect(() =>
      defineRoutes([
        {
          path: '/app',
          layout: noopLayout,
          children: [
            {
              path: 'area',
              use: [mw],
              children: [
                { path: '', view: noopView },
                {
                  path: ':id',
                  layout: noopLayout,
                  children: [{ path: '', view: noopView }],
                },
              ],
            },
          ],
        },
      ])
    ).not.toThrow();
  });

  it('reports all route configuration errors at once', () => {
    let message = '';
    try {
      defineRoutes([
        { path: '/', view: noopView, layout: noopLayout },
        {
          path: '/about',
          view: noopView,
          children: [{ path: 'x', view: noopView }],
        },
      ]);
    } catch (e) {
      message = (e as Error).message;
    }
    // Both violations surface in a single throw.
    expect(message).toMatch(/cannot declare both `view` and `layout`/);
    expect(message).toMatch(/`view` route cannot have `children`/);
    expect(message).toMatch(/2 route configuration errors/);
  });

  it('throws the bare single message when only one rule is violated', () => {
    expect(() =>
      defineRoutes([{ path: '/', view: noopView, layout: noopLayout }])
    ).toThrow(/^Route \/: cannot declare both `view` and `layout`\.$/);
  });

  // (security, P0) the convergent prototype-chain fix: a route can never
  // DECLARE a `:param` named after an Object.prototype member. See
  // isReservedParamName (param-slots.ts) for why: a guard reading
  // ctx.location.pathParams for a request that OMITS such a param would
  // otherwise read the inherited member instead of undefined.

  it('throws at boot for a :constructor route param', () => {
    expect(() =>
      defineRoutes([{ path: '/x/:constructor', view: noopView }])
    ).toThrow(/:constructor/);
    expect(() =>
      defineRoutes([{ path: '/x/:constructor', view: noopView }])
    ).toThrow(/reserved/);
  });

  it('throws at boot for a reserved param name nested under a layout', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/plugin',
          layout: noopLayout,
          children: [{ path: ':toString', view: noopView }],
        },
      ])
    ).toThrow(/:toString/);
  });

  it('names the full joined route path for the offending nested param', () => {
    expect(() =>
      defineRoutes([
        {
          path: '/plugin',
          layout: noopLayout,
          children: [{ path: ':toString', view: noopView }],
        },
      ])
    ).toThrow(/Route \/plugin\/:toString:/);
  });

  it('does not throw for an ordinary route param', () => {
    expect(() =>
      defineRoutes([{ path: '/x/:id', view: noopView }])
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

  it('keys a server-bearing child of a root layout without a doubled slash', () => {
    const s = () => Promise.resolve({ tag: 's' });
    const m = defineRoutes([
      {
        path: '/',
        layout: noopLayout,
        children: [
          { path: '', view: noopView },
          { path: 'x', view: noopView, server: s },
        ],
      },
    ]);
    // The root reset applies to server-route keys exactly as it does to the
    // routeUse keys and the type-level walker: '/x', never '//x'.
    expect(m.serverRoutes.map((r) => r.path)).toEqual(['/x']);
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

  it('registers a root layout group at / and /* (not //*)', () => {
    const m = defineRoutes([
      {
        path: '/',
        layout: noopLayout,
        children: [{ path: '', view: noopView }],
      },
    ]);
    expect(m.flat.map((f) => f.path)).toEqual(['/', '/*']);
    expect(m.flat[0].key).toBe(m.flat[1].key);
  });

  it('flattens a root path-grouping to absolute child paths', () => {
    const m = defineRoutes([
      {
        path: '/',
        children: [
          { path: 'x', view: noopView },
          { path: '/y', view: noopView },
        ],
      },
    ]);
    // Bare and slashed child spellings both normalize to the absolute form.
    expect(m.flat.map((f) => f.path)).toEqual(['/x', '/y']);
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

  it('wires a per-Router load tracker (onLoadStart / onLoadEnd) onto the Router', () => {
    // Routes creates a per-instance load tracker (makeRouterLoadTracker) and
    // wires its coordinator hooks onto the top-level Router, so the cold-flush
    // coordinator can tell this Router apart from nested layout Routers.
    const spy = vi.spyOn(routeChange, 'makeRouterLoadTracker');
    try {
      const m = defineRoutes([{ path: '/', view: noopView }]);
      render(h(LocationProvider, null, h(Routes, { routes: m })) as VNode);
      expect(spy).toHaveBeenCalled();
      const tracker = spy.mock.results[0]!.value as {
        onLoadStart: unknown;
        onLoadEnd: unknown;
      };
      expect(typeof tracker.onLoadStart).toBe('function');
      expect(typeof tracker.onLoadEnd).toBe('function');
    } finally {
      spy.mockRestore();
    }
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
