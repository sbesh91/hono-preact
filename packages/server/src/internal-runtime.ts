// @hono-preact/server/internal/runtime: framework-emitted tier.
//
// These factories exist ONLY because the framework's generated server entry
// imports and calls them (serverEntryPlugin). They are a private contract
// between this version's vite plugins and this version's runtime; they have
// no standalone user story. DO NOT IMPORT FROM USER CODE; this door is
// undocumented and may change in any non-major release in lockstep with the
// codegen that emits it.
export {
  routeServerModules,
  makePageUseResolver,
} from './route-server-modules.js';
export { makePageActionResolvers } from './page-action-resolvers.js';
