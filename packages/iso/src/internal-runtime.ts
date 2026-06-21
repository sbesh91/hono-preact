// @hono-preact/iso/internal/runtime: framework-emitted tier.
//
// Pure plumbing the framework's own code depends on: the installers the
// generated client entry calls, the loader stub the server-only plugin
// emits, and the cross-package wire-contract constants our vite plugins
// import at build time. Users never import this door. It is co-versioned
// with the codegen that emits it and may change in any non-major release.
export { installHistoryShim } from './internal/history-shim.js';
export { installNavTransitionScheduler } from './internal/route-change.js';
export { installStreamRegistry } from './internal/stream-registry.js';
export { installPubSubBackend } from './internal/pubsub.js';
export type { PubSubBackend } from './internal/pubsub.js';
export { __$createLoaderStub_hpiso } from './internal/loader-stub.js';
export * from './internal/contract.js';
export {
  validateWithSchema,
  normalizeIssues,
  mapIssuesToFields,
  type ValidationIssue,
  type ValidationResult,
} from './validate.js';
export { env } from './is-browser.js';
export { coerceLoaderLocation } from './internal/loader-schema.js';
export { collectFormData } from './internal/form-data.js';
