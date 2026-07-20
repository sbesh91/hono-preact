import { getRequestStore } from '../cache.js';
import type { ErrorStatusCode } from '../outcomes.js';

/** The response-level facts a rendered SSR loader deny must apply to the document. */
export type ServerDenyRecord = {
  status: ErrorStatusCode;
  headers: Record<string, string> | undefined;
};

const REGISTRY_KEY = Symbol.for('@hono-preact/server-deny-registry');

/**
 * Record the deny that a rendered SSR loader `errorFallback` stands in for, so
 * `renderPage` can set the document's status + headers after prerender. FIRST
 * write wins: a page renders exactly one document, so the first deny reached in
 * prerender depth-order owns the response; later denies are ignored.
 */
export function recordServerDeny(record: ServerDenyRecord): void {
  const store = getRequestStore();
  if (!store) return; // outside any request scope (e.g. client)
  if (store.get(REGISTRY_KEY) !== undefined) return; // first-write-wins
  store.set(REGISTRY_KEY, record);
}

/**
 * Take ownership of the recorded deny for the current request, clearing it.
 * Called from `renderPage` after prerender resolves, still inside the request
 * scope. Returns null when no loader deny was rendered.
 */
export function takeServerDeny(): ServerDenyRecord | null {
  const store = getRequestStore();
  if (!store) return null;
  const record = store.get(REGISTRY_KEY) as ServerDenyRecord | undefined;
  store.set(REGISTRY_KEY, undefined);
  return record ?? null;
}
