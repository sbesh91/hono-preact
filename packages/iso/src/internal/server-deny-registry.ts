import type { ErrorStatusCode } from '../outcomes.js';
import { readRequestSlot, writeRequestSlot } from './request-scoped-slot.js';

/** The response-level facts a rendered SSR loader deny must apply to the document. */
export type ServerDenyRecord = {
  status: ErrorStatusCode;
  headers: Record<string, string> | undefined;
};

const REGISTRY_KEY = Symbol.for('@hono-preact/server-deny-registry');

/**
 * Record the deny that a rendered SSR loader `errorFallback` stands in for, so
 * `renderPage` can set the document's status + headers after prerender. A page
 * can render more than one denying loader (siblings under the same page), and
 * under `renderToStringAsync` the order their suspended `DataReader`s resolve
 * in is not deterministic. So MOST SEVERE STATUS WINS: the numerically highest
 * status is kept, regardless of which deny was recorded first. This makes the
 * document's status deterministic across identical requests, independent of
 * suspension-resume order.
 */
export function recordServerDeny(record: ServerDenyRecord): void {
  const current = readRequestSlot<ServerDenyRecord>(REGISTRY_KEY);
  if (current === undefined || record.status > current.status) {
    writeRequestSlot(REGISTRY_KEY, record);
  }
}

/**
 * Take ownership of the recorded deny for the current request, clearing it.
 * Called from `renderPage` after prerender resolves, still inside the request
 * scope. Returns null when no loader deny was rendered.
 */
export function takeServerDeny(): ServerDenyRecord | null {
  const record = readRequestSlot<ServerDenyRecord>(REGISTRY_KEY);
  writeRequestSlot<ServerDenyRecord | undefined>(REGISTRY_KEY, undefined);
  return record ?? null;
}
