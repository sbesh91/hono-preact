import { describe, expect, it } from 'vitest';
import { makePageActionResolvers } from '../page-action-resolvers.js';
import type { ServerRoute } from '@hono-preact/iso';

const layoutAction = async () => 'layout-result';
const pageAction = async () => 'page-result';

const layoutThunk = async () => ({
  __moduleKey: 'pages/_layout.server',
  serverActions: { logout: layoutAction },
});
const pageThunk = async () => ({
  __moduleKey: 'pages/foo.server',
  serverActions: { submit: pageAction },
});

const routes: ServerRoute[] = [
  {
    path: '/foo',
    server: pageThunk,
    ancestors: [layoutThunk],
  } as unknown as ServerRoute,
];

describe('makePageActionResolvers', () => {
  it('byPath includes both page and ancestor actions', async () => {
    const { byPath } = makePageActionResolvers(routes, { dev: false });
    const map = await byPath('/foo');
    expect([...map.keys()].sort()).toEqual(['logout', 'submit']);
    expect(map.get('submit')?.moduleKey).toBe('pages/foo.server');
    expect(map.get('logout')?.moduleKey).toBe('pages/_layout.server');
  });

  it('byModuleKey returns the per-action entry for that module', async () => {
    const { byModuleKey } = makePageActionResolvers(routes, { dev: false });
    const entry = await byModuleKey('pages/foo.server', 'submit');
    expect(entry).toBeTruthy();
    expect(entry?.moduleKey).toBe('pages/foo.server');
  });

  it('returns undefined when the action name does not exist on the chain', async () => {
    const { byPath } = makePageActionResolvers(routes, { dev: false });
    const map = await byPath('/foo');
    expect(map.get('nope')).toBeUndefined();
  });

  it('rebuilds on every call in dev mode', async () => {
    let calls = 0;
    const dynamicThunk = async () => {
      calls++;
      return { __moduleKey: 'p', serverActions: { x: async () => 'ok' } };
    };
    const dynamicRoutes: ServerRoute[] = [
      { path: '/p', server: dynamicThunk, ancestors: [] } as unknown as ServerRoute,
    ];
    const { byPath } = makePageActionResolvers(dynamicRoutes, { dev: true });
    await byPath('/p');
    await byPath('/p');
    expect(calls).toBe(2);
  });
});
