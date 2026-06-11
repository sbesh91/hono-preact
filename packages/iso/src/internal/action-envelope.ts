import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Outcome } from '../outcomes.js';

export type ActionEnvelope =
  | { __outcome: 'success'; data: unknown }
  | { __outcome: 'redirect'; to: string; status: number }
  | { __outcome: 'deny'; status: number; message: string; data?: unknown }
  | { __outcome: 'error'; message: string }
  | { __outcome: 'timeout'; timeoutMs: number };

export type ActionResolution =
  | { kind: 'success'; data: unknown }
  | { kind: 'outcome'; outcome: Outcome }
  | { kind: 'error'; message: string };

export type SerializedEnvelope = {
  body: ActionEnvelope;
  status: ContentfulStatusCode;
  headers: Record<string, string> | undefined;
};

/**
 * The defense-in-depth message for `render` outcomes reaching a channel
 * that cannot host them (actions, loaders, root middleware). One copy;
 * the server translators import it from `@hono-preact/iso/internal`.
 */
export const RENDER_PAGE_SCOPE_MESSAGE = 'render outcome is page-scope only';

/**
 * The decoded client-side view of an action response. `unknown` is an
 * envelope object with an unrecognized `__outcome` (consumers surface it
 * as an error); `malformed` is a body that is not an envelope object at
 * all (consumers own the policy: <Form> reloads as a PE fallback,
 * useAction throws).
 */
export type DecodedEnvelope =
  | { kind: 'success'; data: unknown }
  | { kind: 'redirect'; to: string }
  | { kind: 'deny'; status: number; message: string; data?: unknown }
  | { kind: 'error'; message: string }
  | { kind: 'timeout'; timeoutMs: number }
  | {
      kind: 'unknown';
      outcome: string | undefined;
      message: string | undefined;
    }
  | { kind: 'malformed'; httpStatus: number };

export async function decodeActionResponse(
  res: Response
): Promise<DecodedEnvelope> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: 'malformed', httpStatus: res.status };
  }
  if (raw === null || typeof raw !== 'object') {
    return { kind: 'malformed', httpStatus: res.status };
  }
  // Parsing untrusted JSON is the sanctioned cast boundary; this is the one
  // place the wire shape is asserted, so the consumers never cast.
  const env = raw as {
    __outcome?: unknown;
    data?: unknown;
    to?: unknown;
    status?: unknown;
    message?: unknown;
    timeoutMs?: unknown;
  };
  switch (env.__outcome) {
    case 'success':
      return { kind: 'success', data: env.data };
    case 'redirect':
      if (typeof env.to === 'string') return { kind: 'redirect', to: env.to };
      break;
    case 'deny': {
      const status = typeof env.status === 'number' ? env.status : res.status;
      return {
        kind: 'deny',
        status,
        message:
          typeof env.message === 'string'
            ? env.message
            : `Request denied (${status})`,
        data: env.data,
      };
    }
    case 'error':
      return {
        kind: 'error',
        message:
          typeof env.message === 'string' ? env.message : 'Action failed',
      };
    case 'timeout':
      if (typeof env.timeoutMs === 'number') {
        return { kind: 'timeout', timeoutMs: env.timeoutMs };
      }
      break;
  }
  return {
    kind: 'unknown',
    outcome: typeof env.__outcome === 'string' ? env.__outcome : undefined,
    message: typeof env.message === 'string' ? env.message : undefined,
  };
}

export function serializeActionOutcome(
  resolution: ActionResolution
): SerializedEnvelope {
  if (resolution.kind === 'success') {
    return {
      body: { __outcome: 'success', data: resolution.data },
      status: 200,
      headers: undefined,
    };
  }
  if (resolution.kind === 'error') {
    return {
      body: { __outcome: 'error', message: resolution.message },
      status: 500,
      headers: undefined,
    };
  }
  const { outcome } = resolution;
  if (outcome.__outcome === 'redirect') {
    return {
      body: { __outcome: 'redirect', to: outcome.to, status: outcome.status },
      status: 200,
      headers: outcome.headers,
    };
  }
  if (outcome.__outcome === 'deny') {
    const body: ActionEnvelope = {
      __outcome: 'deny',
      status: outcome.status,
      message: outcome.message,
    };
    if (outcome.data !== undefined) body.data = outcome.data;
    return { body, status: outcome.status, headers: outcome.headers };
  }
  if (outcome.__outcome === 'timeout') {
    return {
      body: { __outcome: 'timeout', timeoutMs: outcome.timeoutMs },
      status: 504,
      headers: undefined,
    };
  }
  // 'render' outcome is page-scope only; should never reach an action.
  return {
    body: { __outcome: 'error', message: RENDER_PAGE_SCOPE_MESSAGE },
    status: 500,
    headers: undefined,
  };
}
