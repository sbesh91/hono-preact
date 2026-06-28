# Release note draft: hold-alive guarded navigation

**Behavior change (not a breaking API change).** On a client navigation between
routes that have page-layer middleware (`use`), the previous route now stays
visible while the next route's middleware chain resolves, instead of blanking
out and showing nothing. This makes guarded navigations match the existing
behavior for plain lazy routes.

- No public API surface changed, and apps using the normal `Routes` mounter need
  no migration.
- One breaking contract change for advanced consumers: the page-middleware host
  now relies on the surrounding `Router` (provided by the `Routes` component) as
  its suspense boundary, rather than carrying its own. Code that mounts the host
  directly via `hono-preact/internal` without a `Router` ancestor must add one
  (the default `Routes` already provides it); without it, a guarded route's
  suspension has no boundary to catch it and the navigation will not commit.

Include this in the next minor release notes.
