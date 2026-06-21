// Single source of truth for the recognized named exports a `.server.*`
// file may declare. Two plugins enforce this contract and used to keep
// independent copies of the list, which drifted silently when a new name
// was added:
//
// - `server-only.ts` rejects unknown specifiers when client code imports
//   from a `.server.*` module.
// - `server-loader-validation.ts` runs at build time on the `.server.*`
//   file itself and rejects unknown top-level named exports.
//
// Centralizing the list here forces both to agree by import.
//
// Status of each entry:
// - `serverLoaders`: the loader map the server handler reads at runtime.
// - `serverActions`: the action map the server handler reads at runtime.
// - `serverSockets`: the socket map the WS upgrade handler reads at runtime.
// - `serverRooms`: the room map the WS upgrade handler reads at runtime.
export const RECOGNIZED_SERVER_EXPORTS = [
  'serverActions',
  'serverLoaders',
  'serverRooms',
  'serverSockets',
] as const;

export type RecognizedServerExport = (typeof RECOGNIZED_SERVER_EXPORTS)[number];

export const RECOGNIZED_SERVER_EXPORTS_SET: ReadonlySet<string> = new Set(
  RECOGNIZED_SERVER_EXPORTS
);
