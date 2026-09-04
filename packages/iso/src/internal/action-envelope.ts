import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { DenyCode, Outcome } from '../outcomes.js';
import { isDenyCode } from '../outcomes.js';
import type { DenyRecord } from './deny-record.js';
import { readValidationIssues } from './validation-issues.js';

export type ActionEnvelope =
  | { __outcome: 'success'; data: unknown }
  | { __outcome: 'redirect'; to: string; status: number }
  | {
      __outcome: 'deny';
      status: number;
      message: string;
      data?: unknown;
      code?: DenyCode;
    }
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
 * that cannot host them. Used verbatim by the action envelope and the
 * loader RPC; root middleware composes a longer variant on top of it
 * (see the server package's outcome translation).
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
  | {
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
      code?: DenyCode;
    }
  | { kind: 'error'; message: string }
  | { kind: 'timeout'; timeoutMs: number }
  | {
      kind: 'unknown';
      outcome: string | undefined;
      message: string | undefined;
    }
  | { kind: 'malformed'; httpStatus: number };

/**
 * Project a decoded deny into the {@link DenyRecord} a caller declared a type
 * for. This lives here, beside `decodeActionResponse`, because it is the same
 * boundary: the wire cannot prove `data` matches the deny type inferred from
 * an action's guards, so the claim is made once, in the module that already
 * owns "the wire shape is asserted here so consumers never cast", rather than
 * in `useAction`. `OutcomeSink` deliberately stays `unknown`-typed; only the
 * caller that HAS a declared type calls this.
 *
 * It is also where the claim is made HONEST. A framework-issued schema failure
 * (`pageActionsHandler`'s `deny(422)`) ships the reserved validation-issues bag
 * as its `data`, and that bag has nothing to do with the guards `TData` was
 * inferred from. Claiming it anyway is how `deny.data.loginUrl` would compile
 * and be `undefined` at runtime, so the issues are lifted onto their own
 * `issues` field and `data` is left unset. `readValidationIssues` is the same
 * detection the loader path uses, reused rather than re-spelled.
 */
export function toDenyRecord<TData>(decoded: {
  status: number;
  message: string;
  data?: unknown;
  code?: DenyCode;
}): DenyRecord<TData> {
  const base = {
    status: decoded.status,
    message: decoded.message,
    ...(decoded.code !== undefined ? { code: decoded.code } : {}),
  };
  const issues = readValidationIssues(decoded.data);
  if (issues) return { ...base, issues };
  if (decoded.data === undefined) return base;
  return { ...base, data: decoded.data as TData };
}

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
    code?: unknown;
  };
  switch (env.__outcome) {
    case 'success':
      return { kind: 'success', data: env.data };
    case 'redirect':
      if (typeof env.to === 'string') return { kind: 'redirect', to: env.to };
      break;
    case 'deny': {
      const status = typeof env.status === 'number' ? env.status : res.status;
      const code = isDenyCode(env.code) ? env.code : undefined;
      return {
        kind: 'deny',
        status,
        message:
          typeof env.message === 'string'
            ? env.message
            : `Request denied (${status})`,
        data: env.data,
        ...(code !== undefined ? { code } : {}),
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
    if (outcome.code !== undefined) body.code = outcome.code;
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
