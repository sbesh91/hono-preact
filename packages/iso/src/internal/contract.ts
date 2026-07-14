// Cross-package wire-contract constants. Each constant documents every
// consumer. Standing rule (primitives review, Section F): when a new
// feature needs cross-package agreement on a path, field name, or
// generated id, the value starts life here, not as matching string
// literals. Typed property positions (e.g. `ActionRef.__module`,
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
 * Build artifact listing the client entry's static-import closure (root-relative
 * URLs) for `modulepreload` hinting (see #249). Emitted into the client output
 * by vite `preload-manifest.ts` (`preloadManifestPlugin`); read at runtime by
 * the adapter closure readers (Node `fs` at boot, Cloudflare `ASSETS` at first
 * render). `_FILE` is the bundle/fs name; `_URL` is its served path. Not under
 * a hash: the readers reference a fixed name.
 */
export const PRELOAD_MANIFEST_FILE = '__hp-preload.json';
export const PRELOAD_MANIFEST_URL = `/${PRELOAD_MANIFEST_FILE}`;

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
 * Name of the route-id option set by `serverRoute(r).loader/liveLoader` at
 * runtime. Consumers: iso `server-route.ts` (set), iso `define-loader.ts`
 * (stored on ref); server dispatcher (Tasks 3+) reads it to distinguish
 * route-bound loaders from route-independent ones.
 */
export const ROUTE_ID_OPTION = '__routeId';

/**
 * Form field names carrying the action identity in POSTs. Consumers: iso
 * `form.tsx` (FormData set/skip, hidden inputs) and `action.ts` (stub
 * property definition AND its own FormData append/skip when building
 * non-streaming POST bodies), server `page-actions-handler.ts` (form reads
 * and payload skip), vite `server-only.ts` (generated action stubs).
 */
export const FORM_MODULE_FIELD = '__module';
export const FORM_ACTION_FIELD = '__action';

/**
 * Reserved key under `deny.data` carrying normalized validation issues
 * (`ValidationIssue[]`). Consumers: server `page-actions-handler.ts` (writes it
 * on a schema-failure `deny(422)`), iso `get-validation-issues.ts` (reads it).
 * A schema-failure deny is otherwise indistinguishable from an app-level deny;
 * this framework-owned key is the contract that keeps them apart.
 */
export const VALIDATION_ISSUES_KEY = '__hpValidationIssues';

/** The `deny(422)` message for a schema-validation failure, on both the server
 *  (coerceActionInput) and the client (useAction gate), so they stay identical. */
export const VALIDATION_FAILED_MESSAGE = 'Validation failed';

/**
 * The socket-upgrade endpoint (a header-only GET; selectors ride the query).
 * Consumers: iso `ws-upgrader.ts` (the seam reads this), server
 * `page-actions-handler.ts` (the generated route registration).
 */
export const SOCKETS_RPC_PATH = '/__sockets';

/**
 * Query params selecting which socket: module key + socket name. Consumers:
 * iso `ws-upgrader.ts` (query-param constants), server routes (query reads).
 */
export const SOCKET_MODULE_PARAM = 'm';
export const SOCKET_NAME_PARAM = 's';

/**
 * Query param carrying the JSON-encoded key params for a realtime upgrade: a
 * room's channel key params, or a route-bound socket's route params. Shared by
 * both (the server tells socket from room by registry lookup).
 */
export const SOCKET_KEY_PARAM = 'r';

/**
 * Client socket-stub descriptor field for the socket name (module reuses
 * FORM_MODULE_FIELD). Consumers: iso form builders and action stubs.
 */
export const FORM_SOCKET_FIELD = '__socket';

/** Client room-stub descriptor field carrying the room's export name (the
 * descriptor name used for the `m::name` registry lookup, identical to the
 * `s` query param for sockets). */
export const FORM_ROOM_FIELD = '__room';

/**
 * WebSocket close codes (4000-4999 = application-defined).
 * 4403 Forbidden; 4408 Timeout.
 */
export const WS_DENY_CODE = 4403;
export const WS_TIMEOUT_CODE = 4408;
