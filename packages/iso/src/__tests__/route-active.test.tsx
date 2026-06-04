// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { matchPath, useRouteMatch, useRouteActive } from '../route-active.js';

describe('matchPath', () => {
  it('exact-matches an identical literal path', () => {
    expect(matchPath('/docs', '/docs', true)).toEqual({});
  });

  it('returns null when the path differs', () => {
    expect(matchPath('/docs', '/about', true)).toBeNull();
  });

  it('captures params from a dynamic pattern', () => {
    expect(matchPath('/posts/123', '/posts/:id', true)).toEqual({ id: '123' });
  });

  it('does NOT match a descendant in exact mode', () => {
    expect(matchPath('/posts/123/edit', '/posts/:id', true)).toBeNull();
  });

  it('matches a descendant in non-exact mode', () => {
    expect(
      matchPath('/docs/components/dialog', '/docs/components', false)
    ).toEqual({});
  });

  it('matches the section root itself in non-exact mode', () => {
    expect(matchPath('/docs/components', '/docs/components', false)).toEqual(
      {}
    );
  });

  it('ignores a trailing slash on the route argument', () => {
    expect(matchPath('/docs', '/docs/', true)).toEqual({});
  });

  it('matches the root path only against itself', () => {
    expect(matchPath('/', '/', true)).toEqual({});
    expect(matchPath('/x', '/', true)).toBeNull();
  });

  it('matches any path in non-exact mode for the root route', () => {
    // `/` in non-exact mode is a universal ancestor: every path is a
    // descendant of root, so this is intentionally always-active.
    expect(matchPath('/anything', '/', false)).toEqual({});
  });

  it('supports a wildcard pattern', () => {
    expect(matchPath('/files/a/b', '/files/*', true)).toEqual({});
  });
});

function Probe({ route, exact }: { route: string; exact?: boolean }) {
  const params = useRouteMatch(route, { exact });
  const active = useRouteActive(route, { exact });
  return (
    <div>
      <span data-testid="active">{active ? 'yes' : 'no'}</span>
      <span data-testid="params">{JSON.stringify(params)}</span>
      <a href="/posts/2" data-testid="nav">
        go
      </a>
    </div>
  );
}

// Unmount between renders, and restore the URL so a leaked path (e.g. the
// `/posts/2` that test 3 navigates to) can't bleed into later tests.
afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

describe('useRouteMatch / useRouteActive', () => {
  it('reflects the initial location and captured params', () => {
    history.replaceState(null, '', '/posts/1');
    const { getByTestId } = render(
      <LocationProvider>
        <Probe route="/posts/:id" />
      </LocationProvider>
    );
    expect(getByTestId('active').textContent).toBe('yes');
    expect(getByTestId('params').textContent).toBe('{"id":"1"}');
  });

  it('returns null params and inactive when the route does not match', () => {
    history.replaceState(null, '', '/posts/1');
    const { getByTestId } = render(
      <LocationProvider>
        <Probe route="/about" />
      </LocationProvider>
    );
    expect(getByTestId('active').textContent).toBe('no');
    expect(getByTestId('params').textContent).toBe('null');
  });

  it('re-evaluates after navigation', async () => {
    history.replaceState(null, '', '/posts/1');
    const { getByTestId } = render(
      <LocationProvider>
        <Probe route="/posts/2" exact />
      </LocationProvider>
    );
    expect(getByTestId('active').textContent).toBe('no');
    fireEvent.click(getByTestId('nav'));
    await waitFor(() => expect(getByTestId('active').textContent).toBe('yes'));
  });

  it('matches a descendant when exact is false', () => {
    history.replaceState(null, '', '/docs/components/dialog');
    const { getByTestId } = render(
      <LocationProvider>
        <Probe route="/docs/components" exact={false} />
      </LocationProvider>
    );
    expect(getByTestId('active').textContent).toBe('yes');
  });
});
