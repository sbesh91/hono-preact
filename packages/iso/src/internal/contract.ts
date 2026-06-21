// Cross-package wire-contract constants. Each constant documents every
// consumer. Standing rule (primitives review, Section F): when a new
// feature needs cross-package agreement on a path, field name, or
// generated id, the value starts life here, not as matching string
// literals. Typed property positions (e.g. `ActionStub.__module`,
// `mod.__moduleKey` reads) keep literal syntax; these constants own the
// value positions of the contracts listed below (FormData keys, fetch
// URLs, codegen template strings).

/**
 * RPC endpoint for client loader fetches. Consumers: iso
 * `internal/loader-fetch.ts` (the POST), vite `server-entry.ts` (the
 * generated route registration and the reserved-path validation). The
 * generated server entry mounts `loadersHandler` here.
 */
export const LOADERS_RPC_PATH = '/__loaders';

/**
 * Client bundle entry name and its URL form. Consumers: vite
 * `hono-preact.ts` (rollup `entryFileNames`), iso `client-script.tsx`
 * (the production script src). Must stay stable: it is the URL the SSR
 * layer references.
 */
export const CLIENT_ENTRY_FILE = 'static/client.js';
export const CLIENT_ENTRY_URL = `/${CLIENT_ENTRY_FILE}`;

/**
 * Virtual client-entry module id and its Vite dev-server URL. Consumers:
 * vite `client-entry.ts` (resolveId), iso `client-script.tsx` (the dev
 * script src). Vite's exported VIRTUAL_CLIENT_ENTRY_ID and the
 * clientEntry default in hono-preact.ts are assigned from this constant.
 * The URL form encodes Vite's `/@id/` route plus the `__x00__` escape of
 * the `\0` resolved-id prefix. The /@id/__x00__ encoding is a
 * Vite-internal convention; it breaks only if Vite changes its /@id/
 * escaping, which no local test can detect.
 */
export const VIRTUAL_CLIENT_ID = 'virtual:hono-preact/client';
export const VIRTUAL_CLIENT_DEV_URL = `/@id/__x00__${VIRTUAL_CLIENT_ID}`;

/**
 * Name of the module-key export the vite plugins generate into `.server.*`
 * modules and thread into loader/action stubs. Consumers: vite
 * `module-key-plugin.ts` and `server-only.ts` (codegen). iso and server
 * read it as a typed property (`mod.__moduleKey`); the literal there is
 * the same contract, kept in property syntax. Note:
 * module-key-plugin.ts also embeds this name in its already-transformed
 * detection regex; that regex must be built from this constant.
 */
export const MODULE_KEY_EXPORT = '__moduleKey';

/**
 * Name of the loader-name option the vite module-key plugin threads into
 * `defineLoader` opts for `serverLoaders` entries. Consumers: vite
 * `module-key-plugin.ts` (codegen); iso `define-loader.ts` reads it as a
 * typed option (property syntax there).
 */
export const LOADER_NAME_OPTION = '__loaderName';

/**
 * Form field names carrying the action identity in POSTs. Consumers: iso
 * `form.tsx` (FormData set/skip, hidden inputs) and `action.ts` (stub
 * property definition AND its own FormData append/skip when building
 * non-streaming POST bodies), server `page-action-handler.ts` (form reads
 * and payload skip), vite `server-only.ts` (generated action stubs).
 */
export const FORM_MODULE_FIELD = '__module';
export const FORM_ACTION_FIELD = '__action';

/**
 * The socket-upgrade endpoint (a header-only GET; selectors ride the query).
 * Consumers: iso `ws-upgrader.ts` (the seam reads this), server
 * `page-action-handler.ts` (the generated route registration).
 */
export const SOCKETS_RPC_PATH = '/__sockets';

/**
 * Query params selecting which socket: module key + socket name. Consumers:
 * iso `ws-upgrader.ts` (query-param constants), server routes (query reads).
 */
export const SOCKET_MODULE_PARAM = 'm';
export const SOCKET_NAME_PARAM = 's';

/** Query param carrying the interpolated room key (channel.key(params)) for a room connection. */
export const SOCKET_ROOM_PARAM = 'r';

/**
 * Client socket-stub descriptor field for the socket name (module reuses
 * FORM_MODULE_FIELD). Consumers: iso form builders and action stubs.
 */
export const FORM_SOCKET_FIELD = '__socket';

/** Client room-stub descriptor field (the channel name pattern). */
export const FORM_ROOM_FIELD = '__room';

/**
 * WebSocket close codes (4000-4999 = application-defined).
 * 4403 Forbidden; 4408 Timeout.
 */
export const WS_DENY_CODE = 4403;
export const WS_TIMEOUT_CODE = 4408;
