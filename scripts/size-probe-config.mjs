// Module manifests that define each size probe. The emitter
// (emit-size-probes.mjs) bundles each entry in isolation so
// compressed-size-action can gzip and diff it per PR. Peers in EXTERNAL are
// excluded so a probe reflects only the framework's own code on top of a
// runtime the consumer already ships.

// Framework base. Every feature probe is measured on its own; subtract the
// `core` probe in the PR comment to read a feature's marginal cost.
export const CORE_MODULES = [
  'define-app.js',
  'define-routes.js',
  'define-page.js',
  'page.js',
  'client-script.js',
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
  head: ['head.js'],
  middleware: ['define-middleware.js', 'reload-context.js'],
};

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

// Per-component cost from packages/ui/dist. The shared primitives form the
// `core` ui probe; each component lists the dist module(s) its public entry
// pulls in.
export const UI_CORE_MODULES = [
  'render-element.js',
  'merge-refs.js',
  'use-controllable-state.js',
  'use-presence.js',
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
