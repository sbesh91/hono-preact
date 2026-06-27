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
import {
  defineRoutes,
  Routes,
  type ViewProps,
} from '../define-routes.js';
import {
  resetHistoryShimForTesting,
  setNavDirectionForTesting,
} from '../internal/history-shim.js';

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
