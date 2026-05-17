// Indirect chain: a non-`.server.ts` file that imports from a `.server.ts`
// module. The serverOnlyPlugin rewrites imports of `.server.*` at compile
// time inside EVERY importer, so this re-export chain must still produce a
// client bundle that never embeds the `.server.ts` body. The transitive
// leak test asserts the sentinel is absent even when reached through a
// shim like this one.
import { serverLoaders, serverActions } from './foo.server.js';

export const wrappedLoaders = serverLoaders;
export const wrappedActions = serverActions;
