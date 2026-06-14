// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Fragment, h } from 'preact';
import { useLocation } from 'preact-iso';
import { act, render, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import { contentRoutes } from '../content-routes.js';

const page = (text: string) => (): Promise<unknown> =>
  Promise.resolve({ default: () => h('p', null, text) });

const layout = () =>
  Promise.resolve({
    default: ({ children }: { children: unknown }) =>
      h('main', { 'data-docs': '' }, children as never),
  });

const modules = {
  './pages/docs/index.mdx': page('DOCS HOME'),
  './pages/docs/quick-start.mdx': page('QUICK START'),
  './pages/docs/components/dialog.mdx': page('DIALOG'),
};

const routes = defineRoutes([
  {
    path: '/docs',
    layout,
    children: [
      ...contentRoutes(modules),
      { path: '*', view: page('DOCS 404') },
    ],
  },
  { path: '*', view: page('SITE 404') },
]);

function renderAt(path: string) {
  history.replaceState(null, '', path);
  return render(h(LocationProvider, null, h(Routes, { routes })));
}

afterEach(() => {
  cleanup();
});

describe('contentRoutes integration', () => {
  it('builds without validator error and matches the index', async () => {
    const { findByText } = renderAt('/docs');
    expect(await findByText('DOCS HOME')).toBeTruthy();
  });

  it('matches a nested content path over the catch-all', async () => {
    const { findByText } = renderAt('/docs/components/dialog');
    expect(await findByText('DIALOG')).toBeTruthy();
  });

  it('renders the docs 404 for an unknown docs path, not the site 404', async () => {
    const { findByText, queryByText } = renderAt('/docs/nope');
    expect(await findByText('DOCS 404')).toBeTruthy();
    expect(queryByText('SITE 404')).toBeNull();
  });

  it('keeps the docs layout mounted across docs-to-docs navigation', async () => {
    let route!: (path: string) => void;
    const Grab = () => {
      route = useLocation().route;
      return null;
    };
    history.replaceState(null, '', '/docs');
    const { container, findByText } = render(
      h(
        LocationProvider,
        null,
        h(Fragment, null, h(Grab), h(Routes, { routes }))
      )
    );
    await findByText('DOCS HOME');
    const layoutEl = container.querySelector('[data-docs]');
    expect(layoutEl).toBeTruthy();
    await act(async () => {
      route('/docs/quick-start');
    });
    await findByText('QUICK START');
    // Same DOM node: the layout group reconciled in place, it did not remount.
    expect(container.querySelector('[data-docs]')).toBe(layoutEl);
  });
});
