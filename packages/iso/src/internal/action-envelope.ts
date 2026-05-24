import type {
  Outcome,
  RedirectOutcome,
  DenyOutcome,
  TimeoutOutcome,
} from '../outcomes.js';

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
  status: number;
  headers: Record<string, string> | undefined;
};

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
    body: { __outcome: 'error', message: 'render outcome is page-scope only' },
    status: 500,
    headers: undefined,
  };
}
