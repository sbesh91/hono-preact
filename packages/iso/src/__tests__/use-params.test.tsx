// @vitest-environment happy-dom
import { describe, it, test, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { useParams, __resetParamsWarningsForTesting } from '../use-params.js';

const mockRoute = {
  path: '/demo/projects/p1',
  searchParams: {},
  pathParams: {} as Record<string, string>,
};
vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useRoute: () => mockRoute };
});

// Unmount between renders, and restore the URL so a leaked path can't bleed
// into later tests (mirrors route-active.test.tsx).
afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
  __resetParamsWarningsForTesting();
});

function Harness({ onParams }: { onParams: (p: unknown) => void }) {
  const params = useParams('/demo/projects/:projectId');
  onParams(params);
  return null;
}

// `useParams` also matches the active location against the named route (via
// `useLocation` plus `matchRouteParams`, not stubbed by the `preact-iso` mock
// above), so tests that exercise the dev-warn path render under a real
// `LocationProvider` at a given URL, same idiom as route-active.test.tsx.
function renderAtPath(path: string, Body: () => null) {
  history.replaceState(null, '', path);
  return render(
    <LocationProvider>
      <Body />
    </LocationProvider>
  );
}

describe('useParams', () => {
  it('returns the live route pathParams for the named route', () => {
    // useParams also matches the active location, which needs a real
    // LocationProvider in scope (the preact-iso mock above only stubs
    // useRoute); match at the same path the mock's pathParams describe.
    mockRoute.pathParams = { projectId: 'p1' };
    history.replaceState(null, '', '/demo/projects/p1');
    let seen: unknown;
    render(
      <LocationProvider>
        <Harness onParams={(p) => (seen = p)} />
      </LocationProvider>
    );
    expect(seen).toEqual({ projectId: 'p1' });
  });

  test('warns in dev when the named route is not the active route', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAtPath('/projects/abc', () => {
      useParams('/users/:userId');
      return null;
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("useParams('/users/:userId')")
    );
    warn.mockRestore();
  });

  test('does not warn when the named route is the active route', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAtPath('/users/u1', () => {
      useParams('/users/:userId');
      return null;
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('does not warn for an ancestor route read from a descendant path', () => {
    // Real in-repo case (project-header.tsx, task.tsx): a layout or nested
    // leaf reads an ancestor route's params while the active URL is a
    // descendant of that route (non-exact match), not the route itself.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAtPath('/demo/projects/p1/tasks/t1', () => {
      useParams('/demo/projects/:projectId');
      return null;
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('warns only once per route pattern', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAtPath('/projects/abc', () => {
      useParams('/users/:userId');
      useParams('/users/:userId');
      return null;
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('does not throw when rendered outside a LocationProvider', () => {
    // preact-iso defaults LocationProvider.ctx to `{}`, so `path` is
    // undefined here; useParams must skip the dev-warn match rather than let
    // matchRouteParams reach exec()'s url.split('/') on undefined.
    mockRoute.pathParams = { projectId: 'p1' };
    let seen: unknown;
    expect(() => {
      render(<Harness onParams={(p) => (seen = p)} />);
    }).not.toThrow();
    expect(seen).toEqual({ projectId: 'p1' });
  });
});
