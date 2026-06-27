# Release note draft: hold-alive guarded navigation

**Behavior change (not a breaking API change).** On a client navigation between
routes that have page-layer middleware (`use`), the previous route now stays
visible while the next route's middleware chain resolves, instead of blanking
out and showing nothing. This makes guarded navigations match the existing
behavior for plain lazy routes.

- No public API changed; no migration needed.
- The page-middleware host now relies on the surrounding `Router` (provided by
  the `Routes` component) as its suspense boundary. Apps that hand-compose the
  render pipeline with the `<Page>` escape hatch must ensure a `Router` ancestor
  (the default `Routes` already does).

Include this in the next minor release notes.
