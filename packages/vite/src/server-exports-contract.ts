// Single source of truth for the recognized named exports a `.server.*`
// file may declare. Three plugins enforce this contract and used to keep
// independent copies of the list, which drifted silently when a new name
// was added:
//
// - `server-only.ts` rejects unknown specifiers when client code imports
//   from a `.server.*` module.
// - `server-loader-validation.ts` runs at build time on the `.server.*`
//   file itself and rejects unknown top-level named exports.
// - `server-loaders-parser.ts` documents the middleware-carrying subset
//   (`pageUse`/`loaderUse`/`actionUse`) used by the route map builder.
//
// Centralizing the list here forces all three to agree by import.
//
// Status of each entry:
// - `serverLoaders` / `serverActions`: the two value-bearing exports the
//   handlers read at runtime.
// - `pageUse`: page-layer middleware chain composed into the resolver map
//   in `route-server-modules.ts`. Load-bearing.
// - `loaderUse` / `actionUse`: reserved names for future per-file
//   middleware. The handlers do not yet read them; per-unit middleware
//   rides on `defineLoader({ use })` / `defineAction({ use })`. Plan
//   item E7 may drop them in a follow-up; until then they're recognized
//   so users who write them get an array stub on the client and a
//   passing build instead of an opaque "unknown export" error.
export const RECOGNIZED_SERVER_EXPORTS = [
  'serverActions',
  'serverLoaders',
  'pageUse',
  'loaderUse',
  'actionUse',
] as const;

export type RecognizedServerExport = (typeof RECOGNIZED_SERVER_EXPORTS)[number];

export const RECOGNIZED_SERVER_EXPORTS_SET: ReadonlySet<string> = new Set(
  RECOGNIZED_SERVER_EXPORTS
);

// Subset of RECOGNIZED_SERVER_EXPORTS that names a middleware-carrying
// array. Used by the validation plugin to enforce that values are
// `ArrayExpression` literals (so a typo like `pageUse = singleMw` fails
// the build instead of silently disabling the gate at runtime).
export const RECOGNIZED_USE_EXPORTS = [
  'pageUse',
  'loaderUse',
  'actionUse',
] as const;

export type RecognizedUseExport = (typeof RECOGNIZED_USE_EXPORTS)[number];

export const RECOGNIZED_USE_EXPORTS_SET: ReadonlySet<string> = new Set(
  RECOGNIZED_USE_EXPORTS
);
