import type { Context } from 'hono';
import type { Outcome } from '@hono-preact/iso';
import { RENDER_PAGE_SCOPE_MESSAGE } from '@hono-preact/iso/internal';

/** Apply an outcome's optional headers to the HTTP response. */
export function applyOutcomeHeaders(
  c: Context,
  headers: Record<string, string> | undefined
): void {
  if (!headers) return;
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
}

// Outcome translation for the root chain dispatched around prerender. The
// root layer (appConfig.use) only legitimately produces `redirect` or
// `deny`; a `render` outcome is page-scope and must not flow through here.
// Defense-in-depth: surface programmer error as a 500 rather than crash.
export function translateRootOutcome(c: Context, outcome: Outcome): Response {
  if (outcome.__outcome === 'redirect') {
    applyOutcomeHeaders(c, outcome.headers);
    return c.redirect(outcome.to, outcome.status);
  }
  if (outcome.__outcome === 'deny') {
    applyOutcomeHeaders(c, outcome.headers);
    return c.text(outcome.message ?? 'Forbidden', outcome.status);
  }
  return c.text(
    `${RENDER_PAGE_SCOPE_MESSAGE} and cannot be issued by root middleware`,
    500
  );
}

export function translateOutcomeForLoader(
  c: Context,
  outcome: Outcome
): Response {
  if (outcome.__outcome === 'redirect') {
    // Headers from the outcome ride the HTTP response via `c.header()`. They
    // are deliberately NOT embedded in the JSON envelope: the client only
    // reads `to` and calls `window.location.assign(to)`; any embedded
    // headers would be dead bytes the client never inspects.
    applyOutcomeHeaders(c, outcome.headers);
    return c.json(
      {
        __outcome: 'redirect',
        to: outcome.to,
        status: outcome.status,
      },
      200
    );
  }
  if (outcome.__outcome === 'deny') {
    applyOutcomeHeaders(c, outcome.headers);
    return c.json(
      { __outcome: 'deny', message: outcome.message },
      outcome.status
    );
  }
  if (outcome.__outcome === 'timeout') {
    return c.json({ __outcome: 'timeout', timeoutMs: outcome.timeoutMs }, 504);
  }
  // render outcome should never reach the loader RPC; this is defense in depth.
  return c.json(
    {
      __outcome: 'error',
      message: RENDER_PAGE_SCOPE_MESSAGE,
    },
    500
  );
}
