# Imperative client navigate (Section C, primitive 2) design

**Date:** 2026-06-12
**Status:** Approved design, pre-implementation
**Source:** Section C (primitive 2, "imperative client navigate") of `docs/superpowers/research/2026-06-10-framework-primitives-dx-review.md`. Second of the six site-discovered primitives.
**Goal:** Give the framework a blessed imperative client navigation API so programmatic navigation from a component (logout, post-action flows) is a real client navigation instead of a full-page `window.location.assign`. Ship `useNavigate()`; migrate the site logout off `window.location.assign`.

## Scope decisions (locked with user)

1. **A `useNavigate()` hook (Option 1), not a hook-free module-level navigate.** preact-iso exposes navigation only through `useLocation().route`; there is no exported module-level navigate, and a hook-free `navigate()` would require the framework to capture the active route function in a new module-level singleton kept fresh across renders. That adds another global singleton to a client runtime the review already flagged for having too many, for a capability with no current consumer (logout and realistic programmatic navs happen inside components). Deferred; the hook is the YAGNI-right surface and leaves a clean extension point.
2. **Options are `{ replace, reload }`.** `replace` maps to preact-iso's `route(url, replace)` (replaceState, no new history entry). `reload` is the framework-blessed hard-navigation escape hatch, kept deliberately so user code never reaches for raw `window.location.assign` again (the whole point of the primitive).
3. **The client-visible auth-state (localStorage hint) is out of scope.** It exists because the client middleware cannot read the HttpOnly session cookie; an imperative navigate does not address it, and it is not one of the six primitives. The site's `DEMO_AUTHED_KEY` dance stays.
4. **One PR, iso + the site logout migration.** Additive; no breaking changes.

## API

Exported from the iso barrel (`packages/iso/src/index.ts`):

```ts
export interface NavigateOptions {
  replace?: boolean; // replaceState instead of pushState (no new history entry)
  reload?: boolean; // hard navigation (full page load), for a clean slate
}

export function useNavigate(): (
  path: string,
  options?: NavigateOptions
) => void;
```

`useNavigate()` returns a `navigate` function for use in component event handlers. A soft navigate (the default) goes through preact-iso's `route`, the same entry point a `NavLink`/`<a>` click ends up calling, so the framework's client middleware, loaders, and view transitions all run identically to a link navigation. `reload` does a full-page navigation (clean slate). `replace` avoids pushing a new history entry.

## Implementation

New file `packages/iso/src/use-navigate.ts`:

```ts
import { useCallback } from 'preact/hooks';
import { useLocation } from 'preact-iso';

export interface NavigateOptions {
  replace?: boolean;
  reload?: boolean;
}

export function useNavigate(): (
  path: string,
  options?: NavigateOptions
) => void {
  const { route } = useLocation();
  return useCallback(
    (path: string, options?: NavigateOptions) => {
      if (options?.reload) {
        if (typeof window !== 'undefined') window.location.assign(path);
        return;
      }
      route(path, options?.replace ?? false);
    },
    [route]
  );
}
```

`route` is preact-iso's `useLocation().route` (signature `(url, replace) => void`). The hook must be called within the app's `LocationProvider` tree (every page is). `reload` is guarded for SSR safety even though it is only ever called from client event handlers. The barrel adds `export { useNavigate, type NavigateOptions } from './use-navigate.js';` near the other hooks.

## Site migration (dogfood proof)

`LogoutInline` in `apps/site/src/pages/demo/projects.tsx`:

```ts
const navigate = useNavigate();
const { mutate, pending } = useAction(loginActions.logout, {
  onSuccess: () => {
    try {
      window.localStorage.removeItem(DEMO_AUTHED_KEY);
    } catch {
      // ignore: a soft nav still leaves the in-memory flag cleared
    }
    navigate('/demo/login', { replace: true });
  },
});
```

`replace: true` so the back button does not return to the now-deauthed page. This is a genuine soft client navigation (the demonstration that the primitive works), replacing the `window.location.assign('/demo/login')` hard reload. The stale cached `/projects` loader data is harmless: the client guard bounces any back-navigation (its localStorage flag is cleared), and a subsequent login performs a full reload (the login action's redirect) that clears the cache. The `DEMO_AUTHED_KEY` localStorage handling is unchanged.

## Docs

A short "Navigating programmatically" section on `apps/site/src/pages/docs/active-links.mdx` (it already documents `<NavLink>` and the route-active hooks, so imperative navigation is its natural companion). Show `useNavigate()` with the `replace` and `reload` options, a small `NavigateOptions` API table, and a one-line note that a soft navigate runs middleware/loaders/view transitions like a link click. No new page (so no `nav.ts` change); follow the `add-docs-page` template conventions for the added section.

## Tests

New `packages/iso/src/__tests__/use-navigate.test.tsx`:
- A soft navigate calls preact-iso's `route` with `(path, false)`: render the harness inside a real `LocationProvider` and assert the URL changed (via `useLocation().path`) after `navigate('/x')`, or spy on the route by reading the resulting location. Prefer asserting observable navigation (the location path) over mocking preact-iso internals.
- `navigate('/x', { replace: true })` navigates without pushing a new history entry (assert `history.length` is unchanged across the call, or that the location updated).
- `navigate('/x', { reload: true })` calls `window.location.assign('/x')` and does NOT change the preact-iso location (stub `window.location.assign` with `vi.stubGlobal`/`vi.spyOn` and assert it was called; assert `route` path is unchanged).

If asserting `history.length`/location proves brittle in happy-dom, fall back to wrapping `useLocation().route` via a test `LocationProvider` and asserting the post-navigate `useLocation().path`. The `reload` test is the most important behavioral assertion (it must not soft-navigate).

## Breaking changes

None. `useNavigate`/`NavigateOptions` are additive exports; the site change swaps one `window.location.assign` for the new hook. Recorded in the next release notes as a new feature.

## Out of scope (deferred)

- A hook-free module-level `navigate()` for non-component code (no current consumer; would add a global singleton).
- The client-visible auth-state / localStorage session hint (separate concern: the client cannot read the HttpOnly cookie).
- The other four remaining Section C primitives (each its own spec).
