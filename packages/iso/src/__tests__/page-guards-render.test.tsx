// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { VNode } from 'preact';
import { h } from 'preact';
import { render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineRoutes, Routes } from '../define-routes.js';
import { defineClientMiddleware } from '../define-middleware.js';
import { redirect } from '../outcomes.js';

const leaf = (text: string) => () =>
  Promise.resolve({ default: () => h('div', null, text) });

describe('node use gates the render', () => {
  it('a client guard on a grouping redirects descendants', async () => {
    const denyAll = defineClientMiddleware(async () => {
      throw redirect('/login');
    });
    const routes = defineRoutes([
      { path: '/login', view: leaf('LOGIN') },
      {
        path: '/area',
        use: [denyAll],
        children: [{ path: 'secret', view: leaf('SECRET') }],
      },
    ]);
    // This preact-iso build's LocationProvider ignores the `url` prop and reads
    // the current document location, so drive the route via history (mirrors
    // define-routes.test.tsx).
    history.replaceState(null, '', '/area/secret');
    const { queryByText, findByText } = render(
      h(LocationProvider, null, h(Routes, { routes })) as VNode
    );
    // Positive evidence the guard fired and short-circuited: the redirect lands
    // on LOGIN. Asserting only `SECRET === null` would be a timing false-pass
    // (it is transiently null before the lazy view resolves); waiting for LOGIN
    // means the chain ran, redirected, and the new route committed.
    expect(await findByText('LOGIN')).toBeTruthy();
    // And SECRET, the guarded descendant, never commits.
    await waitFor(() => {
      expect(queryByText('SECRET')).toBeNull();
    });
  });

  it('an unguarded sibling renders normally', async () => {
    const routes = defineRoutes([
      { path: '/login', view: leaf('LOGIN') },
      {
        path: '/area',
        use: [
          defineClientMiddleware(async () => {
            throw redirect('/login');
          }),
        ],
        children: [{ path: 'secret', view: leaf('SECRET') }],
      },
    ]);
    history.replaceState(null, '', '/login');
    const { findByText } = render(
      h(LocationProvider, null, h(Routes, { routes })) as VNode
    );
    expect(await findByText('LOGIN')).toBeTruthy();
  });
});
