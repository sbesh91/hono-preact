// @hono-preact/server/internal/runtime: framework-emitted tier.
//
// createServerEntry exists ONLY because the framework's generated server entry
// imports and calls it (serverEntryPlugin). It is a private contract between
// this version's vite plugins and this version's runtime; it has no standalone
// user story. DO NOT IMPORT FROM USER CODE; this door is undocumented and may
// change in any non-major release in lockstep with the codegen that emits it.
export {
  createServerEntry,
  type CreateServerEntryOptions,
} from './create-server-entry.js';

// The modulepreload artifact reader seam. The adapter's generated entry installs
// a platform reader (Node `fs`, Cloudflare `ASSETS`); `renderPage` resolves it
// to emit `modulepreload` hints (entry closure + matched route) + a `Link`
// header (see issue #249).
export {
  installPreloadModules,
  type PreloadModulesReader,
} from './preload-modules.js';
