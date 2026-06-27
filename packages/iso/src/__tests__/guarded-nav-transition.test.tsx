// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render as rtlRender,
  cleanup,
  waitFor,
  fireEvent,
  findByTestId,
} from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { h, type ComponentType } from 'preact';
import { defineClientMiddleware } from '../define-middleware.js';
import { redirect } from '../outcomes.js';
import {
  defineRoutes,
  Routes,
  type ViewProps,
} from '../define-routes.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';
import {
  installNavTransitionScheduler,
  __resetTransitionStateForTesting,
} from '../internal/route-change.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetHistoryShimForTesting();
  if (typeof window !== 'undefined') window.history.replaceState({}, '', '/');
});

describe('cold guarded nav: no interactive duplicate content', () => {
  it('shows only the outgoing route while the incoming chain is pending', async () => {
    const gate: { release?: () => void } = {};
    const gatedMw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        gate.release = r;
      });
      await next();
    });
    const AView: ComponentType<ViewProps> = () =>
      h(
        'div',
        null,
        h('a', { href: '/b', 'data-testid': 'to-b' }, 'go b'),
        h('button', { 'data-testid': 'a-btn' }, 'A action')
      );
    const BView: ComponentType<ViewProps> = () =>
      h('button', { 'data-testid': 'b-btn' }, 'B action');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [gatedMw],
      },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    const link = await findByTestId(container, 'to-b');
    setNavDirectionForTesting('push');
    fireEvent.click(link);

    // While B's chain is gated (pending): A's interactive content is present,
    // B's is not. Exactly one route's interactive content is in the DOM.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="a-btn"]')).not.toBeNull()
    );
    expect(container.querySelector('[data-testid="b-btn"]')).toBeNull();
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(1);

    gate.release?.();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="b-btn"]')).not.toBeNull()
    );
  });
});

describe('guarded cold nav under the nav-transition scheduler', () => {
  afterEach(() => {
    __resetTransitionStateForTesting();
  });

  it('completes a guarded navigation with the scheduler installed', async () => {
    installNavTransitionScheduler();

    const slowMw = defineClientMiddleware(async (_c, next) => {
      await Promise.resolve();
      await Promise.resolve();
      await next();
    });
    const AView: ComponentType<ViewProps> = () =>
      h('a', { href: '/b', 'data-testid': 'to-b' }, 'go b');
    const BView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-B' }, 'route-B');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [slowMw],
      },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    const link = await findByTestId(container, 'to-b');
    setNavDirectionForTesting('push');
    fireEvent.click(link);

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-testid="route-B"]')
        ).not.toBeNull(),
      { timeout: 3000 }
    );
  });
});

describe('guarded nav edge cases', () => {
  it('a guarded chain that redirects during nav lands on the redirect target', async () => {
    const redirectMw = defineClientMiddleware(async () => {
      await Promise.resolve();
      throw redirect('/c');
    });
    const passMw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    const AView: ComponentType<ViewProps> = () =>
      h('a', { href: '/b', 'data-testid': 'to-b' }, 'go b');
    const BView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-B' }, 'route-B');
    const CView: ComponentType<ViewProps> = () =>
      h('div', { 'data-testid': 'route-C' }, 'route-C');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: AView }) },
      {
        path: '/b',
        view: () => Promise.resolve({ default: BView }),
        use: [redirectMw],
      },
      {
        path: '/c',
        view: () => Promise.resolve({ default: CView }),
        use: [passMw],
      },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );
    const link = await findByTestId(container, 'to-b');
    setNavDirectionForTesting('push');
    fireEvent.click(link);

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-testid="route-C"]')
        ).not.toBeNull(),
      { timeout: 3000 }
    );
    expect(container.querySelector('[data-testid="route-B"]')).toBeNull();
  });

  it('rapid double-nav lands on the final target, not a superseded one', async () => {
    const mk = (id: string) => {
      const mw = defineClientMiddleware(async (_c, next) => {
        await Promise.resolve();
        await Promise.resolve();
        await next();
      });
      const View: ComponentType<ViewProps> = () =>
        h(
          'div',
          null,
          h('div', { 'data-testid': `route-${id}` }, `route-${id}`),
          h('a', { href: '/c', 'data-testid': 'to-c' }, 'c')
        );
      return { mw, View };
    };
    const a = mk('A');
    const b = mk('B');
    const c = mk('C');

    const manifest = defineRoutes([
      { path: '/a', view: () => Promise.resolve({ default: a.View }), use: [a.mw] },
      { path: '/b', view: () => Promise.resolve({ default: b.View }), use: [b.mw] },
      { path: '/c', view: () => Promise.resolve({ default: c.View }), use: [c.mw] },
    ]);

    window.history.replaceState({}, '', '/a');
    const { container } = rtlRender(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );
    await waitFor(() =>
      expect(container.querySelector('[data-testid="route-A"]')).not.toBeNull()
    );

    // Navigate A -> B, then immediately B -> C before B settles.
    setNavDirectionForTesting('push');
    window.history.pushState(null, '', '/b');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.history.pushState(null, '', '/c');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-testid="route-C"]')
        ).not.toBeNull(),
      { timeout: 3000 }
    );
    expect(container.querySelector('[data-testid="route-B"]')).toBeNull();
  });
});
