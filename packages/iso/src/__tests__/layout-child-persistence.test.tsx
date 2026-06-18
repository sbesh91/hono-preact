// packages/iso/src/__tests__/layout-child-persistence.test.tsx
// @vitest-environment happy-dom
//
// Guards the core property behind layout-based persistence: a component a
// layout renders as a plain sibling of {children} persists (no remount, state
// + a live resource survive) across intra-scope navigation, tears down cleanly
// on scope exit, and remounts fresh on re-entry. This is the mechanism that
// replaces <Persist>.
import { describe, it, expect, beforeEach } from 'vitest';
import type { ComponentType } from 'preact';
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  fireEvent,
  render,
  findByTestId,
  waitFor,
} from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import {
  defineRoutes,
  Routes,
  type LayoutProps,
  type ViewProps,
} from '../define-routes.js';

let barMounts = 0;
let liveConnections = 0;

beforeEach(() => {
  barMounts = 0;
  liveConnections = 0;
});

const Bar: ComponentType = () => {
  const [seq] = useState(() => ++barMounts);
  const [count, setCount] = useState(0);
  useEffect(() => {
    liveConnections++;
    return () => {
      liveConnections--;
    };
  }, []);
  return h(
    'div',
    { 'data-testid': 'bar', 'data-seq': String(seq) },
    h('span', { 'data-testid': 'bar-count' }, String(count)),
    h('button', { 'data-testid': 'bar-inc', onClick: () => setCount((c) => c + 1) }, 'inc')
  );
};

const Layout: ComponentType<LayoutProps> = ({ children }) =>
  h('div', null, children as never, h(Bar, null));

const IndexView: ComponentType<ViewProps> = () =>
  h(
    'div',
    null,
    h('a', { href: '/app/123', 'data-testid': 'to-detail' }, 'detail'),
    h('a', { href: '/other', 'data-testid': 'to-other' }, 'leave')
  );
const DetailView: ComponentType<ViewProps> = () =>
  h(
    'div',
    null,
    h('a', { href: '/app', 'data-testid': 'to-index' }, 'back'),
    h('a', { href: '/other', 'data-testid': 'to-other' }, 'leave')
  );
const OtherView: ComponentType<ViewProps> = () =>
  h('a', { href: '/app', 'data-testid': 'to-app' }, 'enter');

const manifest = defineRoutes([
  {
    path: '/app',
    layout: () => Promise.resolve({ default: Layout }),
    children: [
      { path: '', view: () => Promise.resolve({ default: IndexView }) },
      { path: ':id', view: () => Promise.resolve({ default: DetailView }) },
    ],
  },
  { path: '/other', view: () => Promise.resolve({ default: OtherView }) },
]);

describe('layout-child persistence', () => {
  it('persists across intra-scope nav, tears down on exit, remounts on re-entry', async () => {
    history.replaceState(null, '', '/app');
    const { container } = render(
      h(LocationProvider, null, h(Routes, { routes: manifest }))
    );

    await findByTestId(container, 'bar');
    expect(barMounts).toBe(1);
    await waitFor(() => expect(liveConnections).toBe(1));

    fireEvent.click(await findByTestId(container, 'bar-inc'));
    fireEvent.click(await findByTestId(container, 'bar-inc'));
    await waitFor(() =>
      expect(
        (container.querySelector('[data-testid=bar-count]') as HTMLElement)
          .textContent
      ).toBe('2')
    );

    // Intra-scope nav: no remount, state preserved.
    fireEvent.click(await findByTestId(container, 'to-detail'));
    await findByTestId(container, 'to-index');
    expect(barMounts).toBe(1);
    expect(liveConnections).toBe(1);
    expect(
      (container.querySelector('[data-testid=bar]') as HTMLElement).dataset.seq
    ).toBe('1');
    expect(
      (container.querySelector('[data-testid=bar-count]') as HTMLElement)
        .textContent
    ).toBe('2');

    // Leave the scope: bar gone, connection torn down (a transient remount on
    // the way out is preact-iso rendering the outgoing route during the swap;
    // assert the end state).
    const mountsBeforeExit = barMounts;
    fireEvent.click(await findByTestId(container, 'to-other'));
    await findByTestId(container, 'to-app');
    expect(container.querySelector('[data-testid=bar]')).toBeNull();
    await waitFor(() => expect(liveConnections).toBe(0));
    expect(barMounts).toBeGreaterThan(mountsBeforeExit);

    // Re-enter: fresh instance, one connection, reset state.
    const mountsBeforeReentry = barMounts;
    fireEvent.click(await findByTestId(container, 'to-app'));
    await findByTestId(container, 'bar');
    expect(barMounts).toBeGreaterThan(mountsBeforeReentry);
    await waitFor(() => expect(liveConnections).toBe(1));
    expect(
      (container.querySelector('[data-testid=bar-count]') as HTMLElement)
        .textContent
    ).toBe('0');
  });
});
