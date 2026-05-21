import type { FunctionComponent } from 'preact';
import type {
  RedirectStatusCode,
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from 'hono/utils/http-status';

export type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;
export type { RedirectStatusCode };

export type RedirectOutcome = {
  __outcome: 'redirect';
  to: string;
  status: RedirectStatusCode;
  headers: Record<string, string> | undefined;
};

export type DenyOutcome = {
  __outcome: 'deny';
  status: ErrorStatusCode;
  message: string | undefined;
  headers: Record<string, string> | undefined;
};

export type RenderOutcome = {
  __outcome: 'render';
  Component: FunctionComponent;
};

export type Outcome = RedirectOutcome | DenyOutcome | RenderOutcome;

type RedirectInput =
  | string
  | {
      to: string;
      status?: RedirectStatusCode;
      headers?: Record<string, string>;
    };

export function redirect(input: RedirectInput): RedirectOutcome {
  if (typeof input === 'string') {
    return {
      __outcome: 'redirect',
      to: input,
      status: 302,
      headers: undefined,
    };
  }
  return {
    __outcome: 'redirect',
    to: input.to,
    status: input.status ?? 302,
    headers: input.headers,
  };
}

type DenyInput = {
  status: ErrorStatusCode;
  message?: string;
  headers?: Record<string, string>;
};

export function deny(status: ErrorStatusCode, message?: string): DenyOutcome;
export function deny(spec: DenyInput): DenyOutcome;
export function deny(a: ErrorStatusCode | DenyInput, b?: string): DenyOutcome {
  if (typeof a === 'object') {
    return {
      __outcome: 'deny',
      status: a.status,
      message: a.message,
      headers: a.headers,
    };
  }
  return {
    __outcome: 'deny',
    status: a,
    message: b,
    headers: undefined,
  };
}

export function isOutcome(value: unknown): value is Outcome {
  if (typeof value !== 'object' || value === null) return false;
  if (!('__outcome' in value)) return false;
  const tag = (value as { __outcome: unknown }).__outcome;
  return tag === 'redirect' || tag === 'deny' || tag === 'render';
}

export function isRedirect(value: unknown): value is RedirectOutcome {
  return isOutcome(value) && value.__outcome === 'redirect';
}

export function isDeny(value: unknown): value is DenyOutcome {
  return isOutcome(value) && value.__outcome === 'deny';
}

export function isRender(value: unknown): value is RenderOutcome {
  return isOutcome(value) && value.__outcome === 'render';
}
