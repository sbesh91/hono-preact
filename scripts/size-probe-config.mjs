// Module manifests that define each measured unit. measure-framework-size.mjs
// bundles each entry in isolation (esbuild, peers external) and gzips it, so a
// row reflects only the framework's own code on top of a runtime the consumer
// already ships.
//
// Two properties of this probe to keep in mind when reading the numbers:
//  - Marginals are NON-ADDITIVE UPPER BOUNDS. Each feature is bundled with
//    `core` and its whole transitive graph, so two features that share an
//    internal module both count those shared bytes. Summing rows over-states a
//    real page (see the `ui-core` note below for the same effect on components).
//  - It cannot see the app build's dynamic `import()` splits. The probe
//    force-includes every module (measure script uses `export * as`), so a
//    feature that lazy-loads part of itself in a real app (e.g. `actions`
//    dynamically imports sse-decoder + validate) is reported here as if it
//    shipped that code eagerly. Real per-route bytes are a separate measurement.

// Framework base: what every route ships regardless of features used. `outcomes`
// lives here (not under `actions`) because it ships on every route via
// Routes -> define-routes -> page-middleware-host, independent of action usage.
// `page-only.js` is the `hono-preact/page` authoring surface (the `render`
// outcome plus re-exports of `outcomes`); it ships client runtime, so it is
// attributed here rather than excluded (its unique cost over `outcomes` is ~40 B).
// Each feature's marginal cost over `core` is gzip(core+feature) - gzip(core).
export const CORE_MODULES = [
  'define-app.js',
  'define-routes.js',
  'define-page.js',
  'page.js',
  'client-script.js',
  'is-browser.js',
  'outcomes.js',
  'page-only.js',
];

export const FEATURE_MODULES = {
  // Always-on, NOT opt-in: the generated client entry (client-entry.ts) calls
  // bootClient(), which installs the history shim, the nav-transition
  // scheduler, and the stream registry unconditionally, so every route pays
  // this on top of `core`. Broken out as its own row (rather than folded into
  // `core`) so a regression in the boot runtime is legible instead of hidden
  // in the core total. `route-change` transitively pulls
  // view-transition-event + history-shim.
  runtime: [
    'boot-client.js',
    'internal/history-shim.js',
    'internal/route-change.js',
    'internal/stream-registry.js',
  ],
  loaders: ['define-loader.js', 'cache.js'],
  actions: [
    'action.js',
    'form.js',
    'optimistic.js',
    'optimistic-action.js',
    'action-result-context.js',
    'use-action-result.js',
    'use-form-status.js',
    'use-field-errors.js',
  ],
  // Client realtime cost: the WS room/socket hooks (which pull ws-lifecycle,
  // room-envelope, contract) plus the reactive pubsub primitive. Deliberately
  // excludes the server-side surface (define-room/socket/channel, upgrade-websocket,
  // streaming-ssr) which never ships to the browser, so this stays a client number.
  realtime: ['use-room.js', 'use-socket.js', 'pubsub.js'],
  transitions: [
    'view-transition-lifecycle.js',
    'view-transition-name.js',
    'view-transition-types.js',
  ],
  // `prefetch.js` is the speculation-rules helper; `use-prefetch.js` is the hook
  // a route calls. Both belong here so the hook is not an unmeasured entry point
  // (it is a thin wrapper over prefetch.js, but it must stay attributed).
  prefetch: ['prefetch.js', 'use-prefetch.js'],
  // Client routing surface below core: the NavLink component, active-route and
  // navigation/params hooks, typed path builder, and content-route helper. Each
  // is small, but together ~1 KB that shipped attributed to no bucket.
  routing: [
    'nav-link.js',
    'route-active.js',
    'use-navigate.js',
    'use-params.js',
    'build-path.js',
    'content-routes.js',
  ],
  // The opt-in stream-observer API + its client runner. The always-on registry
  // (stream-registry) is in `runtime`; the SSR path (streaming-ssr) is server-only
  // (imports the request store), so neither belongs here. `define-stream-observer`
  // alone is a ~40 B stub; the runner is where the real client bytes are.
  streaming: [
    'define-stream-observer.js',
    'internal/stream-observer-runner.js',
  ],
  head: ['head.js'],
  middleware: ['define-middleware.js', 'reload-context.js'],
};

// Top-level dist modules intentionally NOT attributed to any bucket, so the
// manifest-completeness gate (size-manifest-completeness.test.mjs) does not flag
// them. Every entry is a public module that does not ship client bytes to a
// route, so measuring it as a client feature would be misleading. A NEW
// top-level client module is a deliberate omission from this list, which forces
// the gate to fail until it is bucketed. Keep each entry justified:
export const EXCLUDED_MODULES = [
  // Server-authored realtime definitions: called in server room/socket modules
  // to register handlers; never part of a client route's graph (the client uses
  // the use-room / use-socket hooks, which are in the `realtime` bucket).
  'define-channel.js',
  'define-room.js',
  'define-socket.js',
  // Server-only.
  'server-route.js', // server RPC route surface
  'upgrade-websocket.js', // server-side WebSocket upgrade helper
  // Re-export barrels: no bytes of their own; measuring one measures everything.
  'index.js',
  'internal.js',
  'internal-runtime.js',
  // Type-only helper: `export {}` after tsc strips its type-only exports.
  'infer.js',
];

// Peers a consumer already has; excluded so a probe measures only the
// framework's own bytes on top of preact. Anything NOT listed here (e.g. a
// third-party dep a feature drags in) is intentionally counted.
export const EXTERNAL = [
  'preact',
  'preact/*',
  'preact-iso',
  'preact-iso/*',
  'hono',
  'hono/*',
];

// Per-component cost from packages/ui/dist. `ui-core` is the shared substrate a
// multi-component page loads once; each component row is its own unique bytes on
// top of that base. To keep the rows additive, `ui-core` must hold every module
// shared by >=3 of the 8 public components (the positioner + dismiss cluster,
// collection-navigation, and safe-area/focus utilities). If a shared module is
// omitted here it is re-counted in every component that uses it, which is how the
// popover family and the menu family used to over-state by up to ~3.7x. Re-derive
// the membership by resolving each component entry's transitive dist graph and
// keeping modules with a >=3/8 import count.
export const UI_CORE_MODULES = [
  'render-element.js',
  'merge-refs.js',
  'use-controllable-state.js',
  'use-presence.js',
  // positioner + dismiss cluster (6/8)
  'use-position.js',
  'use-positioner.js',
  'positioner.js',
  'positioner-context.js',
  'arrow.js',
  'use-dismiss.js',
  'dismiss-stack.js',
  // collection navigation (4/8)
  'list-navigation.js',
  'use-typeahead.js',
  // focus + safe-area utilities (3/8)
  'use-focus-return.js',
  'use-safe-area.js',
  'safe-area.js',
];

export const COMPONENT_MODULES = {
  dialog: ['dialog/index.js'],
  popover: ['popover/index.js'],
  tooltip: ['tooltip/index.js'],
  menu: ['menu/index.js'],
  'context-menu': ['context-menu/index.js'],
  select: ['select/index.js'],
  combobox: ['combobox/index.js'],
  toast: ['toast/index.js'],
};
