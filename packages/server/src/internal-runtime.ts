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
