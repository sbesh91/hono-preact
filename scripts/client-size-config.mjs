// Pure configuration + helpers for client JS size tracking. No I/O here so it
// is trivially unit-testable. See docs/superpowers/specs/2026-06-01-client-js-
// size-tracking-design.md.

// Section A: framework runtime cost per feature. Each bucket lists the iso
// dist module basenames whose public surface defines that feature. Paths are
// resolved against packages/iso/dist/ by the measure script.
export const CORE_MODULES = [
  'define-app.js',
  'define-routes.js',
  'define-page.js',
  'page.js',
  'client-script.js',
  'route-change.js',
  'is-browser.js',
];

export const FEATURE_MODULES = {
  loaders: ['define-loader.js', 'cache.js'],
  actions: [
    'action.js',
    'form.js',
    'optimistic.js',
    'optimistic-action.js',
    'outcomes.js',
    'action-result-context.js',
    'use-action-result.js',
    'use-form-status.js',
  ],
  transitions: [
    'view-transition-lifecycle.js',
    'view-transition-name.js',
    'view-transition-types.js',
  ],
  prefetch: ['prefetch.js'],
  streaming: ['define-stream-observer.js'],
  // No `guards` bucket: legacy guards were demolished and folded into the
  // unified middleware primitive (see git history, "demolish legacy guards"),
  // so there is no guard source module in iso to measure in Section A. The
  // Section B `guard` chunk prefix below is kept only in case the site still
  // emits a guard-named chunk.
  head: ['head.js'],
  persist: ['persist.js'],
  middleware: ['define-middleware.js', 'reload-context.js'],
};

// Peers a consumer already has; excluded so Section A measures only the
// framework's own code on top of preact. Anything NOT listed here (e.g. a
// third-party dep a feature drags in) is intentionally counted as that
// feature's cost.
export const EXTERNAL = [
  'preact',
  'preact/*',
  'preact-iso',
  'preact-iso/*',
  'hono',
  'hono/*',
];

// Section C: per-component cost from packages/ui/dist. The shared primitives
// form the `ui-core` floor; each component lists the dist module(s) its public
// entry pulls in. Measured like Section A: total (isolated) plus marginal over
// ui-core (= (ui-core + component) bundle - ui-core bundle).
export const UI_CORE_MODULES = [
  'use-render.js',
  'merge-refs.js',
  'use-controllable-state.js',
];

export const COMPONENT_MODULES = {
  dialog: ['dialog/index.js'],
};

// Section B: ordered prefix -> bucket for the site's emitted chunks. A prefix
// matches a filename `${name}.js` exactly or any `${name}-<hash>.js`. First
// match wins; unmatched chunks fall through to 'app'. Keep prefixes explicit
// (no ambiguous short stems) so ordering rarely matters.
export const CHUNK_PREFIXES = [
  // Component-area docs pages (`/docs/components/*`). The guide pages already
  // land in topical feature buckets below; group the component pages too so
  // they read as their own line instead of inflating `app`. Add a prefix here
  // as each new component page ships. `use-form-status` is bucketed to
  // `actions` below, so list these specific names before it.
  ['dialog', 'components'],
  ['use-render', 'components'],
  ['use-controllable-state', 'components'],
  ['merge-refs', 'components'],
  ['components', 'components'], // the Components-area landing page chunk
  ['guard', 'guards'],
  ['loader-stub', 'loaders'],
  ['loaders', 'loaders'],
  ['optimistic-ui', 'actions'],
  ['use-form-status', 'actions'],
  ['actions', 'actions'],
  ['view-transition-name', 'transitions'],
  ['view-transition-types', 'transitions'],
  // The iso *source* module view-transitions.tsx was split into the three
  // view-transition-* modules above, but the site still emits a
  // `view-transitions-*` client chunk, so this Section B prefix stays.
  ['view-transitions', 'transitions'],
  ['link-prefetch', 'prefetch'],
  ['prefetch', 'prefetch'],
  ['sse-decoder', 'streaming'],
  ['stream-registry', 'streaming'],
  ['streaming', 'streaming'],
  ['hono-middleware', 'middleware'],
  ['middleware', 'middleware'],
  ['reloading', 'middleware'],
  ['router', 'core'],
  ['routes', 'core'],
  ['route-change', 'core'],
  ['render-page', 'core'],
  ['define-page', 'core'],
  ['pages', 'core'],
  ['layouts', 'core'],
  ['structure', 'core'],
  ['is-browser', 'core'],
  ['loading-states', 'core'],
  ['history-shim', 'core'],
  ['csrf', 'core'],
  ['websockets', 'core'],
  ['client', 'core'], // matches any client-*.js chunk, not only the framework entry; keep in mind if a non-framework chunk with a "client" stem is added
  ['hoofd.module', 'vendor'],
  ['hooks.module', 'vendor'],
  ['jsxRuntime.module', 'vendor'],
  ['preload-helper', 'vendor'],
];

// True if a site chunk filename belongs to `bucket` under `prefix`.
function prefixMatches(filename, prefix) {
  return filename === `${prefix}.js` || filename.startsWith(`${prefix}-`);
}

// Maps a single emitted chunk filename to its bucket; 'app' if unmatched.
export function bucketForChunk(filename) {
  for (const [prefix, bucket] of CHUNK_PREFIXES) {
    if (prefixMatches(filename, prefix)) return bucket;
  }
  return 'app';
}

// The gzip number shown in the Section A table for a bucket: `core` shows its
// own total; every other feature shows its marginal cost over core.
export function tableGzip(bucket, entry) {
  return bucket === 'core' ? entry.total.gzip : entry.marginalOverCore.gzip;
}

// The gzip number shown in the Section C table for a component: `ui-core`
// shows its own total; every component shows its marginal cost over ui-core.
export function componentTableGzip(name, entry) {
  return name === 'ui-core' ? entry.total.gzip : entry.marginalOverUiCore.gzip;
}
