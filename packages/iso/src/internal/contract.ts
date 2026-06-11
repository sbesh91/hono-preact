// Cross-package wire-contract constants. Each constant documents every
// consumer. Standing rule (primitives review, Section F): when a new
// feature needs cross-package agreement on a path, field name, or
// generated id, the value starts life here, not as matching string
// literals. Typed property positions (e.g. `ActionStub.__module`,
// `mod.__moduleKey` reads) keep literal syntax; these constants own every
// value position (FormData keys, fetch URLs, codegen template strings).

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
 * script src). The URL form encodes Vite's `/@id/` route plus the
 * `__x00__` escape of the `\0` resolved-id prefix.
 */
export const VIRTUAL_CLIENT_ID = 'virtual:hono-preact/client';
export const VIRTUAL_CLIENT_DEV_URL = `/@id/__x00__${VIRTUAL_CLIENT_ID}`;

/**
 * Name of the module-key export the vite plugins generate into `.server.*`
 * modules and thread into loader/action stubs. Consumers: vite
 * `module-key-plugin.ts` and `server-only.ts` (codegen). iso and server
 * read it as a typed property (`mod.__moduleKey`); the literal there is
 * the same contract, kept in property syntax.
 */
export const MODULE_KEY_EXPORT = '__moduleKey';

/**
 * Form field names carrying the action identity in POSTs. Consumers: iso
 * `form.tsx` (FormData set/skip, hidden inputs) and `action.ts` (stub
 * property definition), server `page-action-handler.ts` (form reads and
 * payload skip), vite `server-only.ts` (generated action stubs).
 */
export const FORM_MODULE_FIELD = '__module';
export const FORM_ACTION_FIELD = '__action';
