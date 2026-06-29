import type { FunctionComponent } from 'preact';
import type {
  RedirectStatusCode,
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from 'hono/utils/http-status';

export type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;
export type { RedirectStatusCode };

/**
 * A named, statically-known deny code vocabulary. It decorates the numeric HTTP
 * `status` so a client can `switch` on a typed code instead of sniffing the
 * message string. `status` stays authoritative; `code` is optional decoration.
 */
export type DenyCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL';

/** Default HTTP status for each code, used when `deny(code)` omits a status. */
export const DENY_CODE_STATUS: Record<DenyCode, ErrorStatusCode> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
};

export type RedirectOutcome = {
  __outcome: 'redirect';
  to: string;
  status: RedirectStatusCode;
  headers: Record<string, string> | undefined;
};

export type DenyOutcome = {
  __outcome: 'deny';
  status: ErrorStatusCode;
  message: string;
  headers: Record<string, string> | undefined;
  data?: unknown;
  code?: DenyCode;
};

export type RenderOutcome = {
  __outcome: 'render';
  Component: FunctionComponent;
};

export type TimeoutOutcome = {
  __outcome: 'timeout';
  timeoutMs: number;
};

export type Outcome =
  | RedirectOutcome
  | DenyOutcome
  | RenderOutcome
  | TimeoutOutcome;

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
  status?: ErrorStatusCode;
  code?: DenyCode;
  message?: string;
  headers?: Record<string, string>;
  data?: unknown;
};

type DenyOptions = {
  headers?: Record<string, string>;
  data?: unknown;
};

export function deny(
  status: ErrorStatusCode,
  message?: string,
  opts?: DenyOptions
): DenyOutcome;
export function deny(
  code: DenyCode,
  message?: string,
  opts?: DenyOptions
): DenyOutcome;
export function deny(spec: DenyInput): DenyOutcome;
export function deny(
  a: ErrorStatusCode | DenyCode | DenyInput,
  b?: string,
  c?: DenyOptions
): DenyOutcome {
  // `JSON.stringify` drops `undefined` properties, so a deny outcome with no
  // message would arrive at the client without a `message` field and the
  // client decoders would fall back to a generic "Loader/Action failed with
  // status N" string. Default to a status-aware message at construction time
  // so the wire envelope always carries something useful. Callers can still
  // pass a richer message; defense-in-depth on the client side fills in a
  // similar fallback if a hand-rolled envelope ships without `message`.
  // Object form: status may be explicit or inferred from the code.
  if (typeof a === 'object') {
    const status =
      a.status ?? (a.code ? DENY_CODE_STATUS[a.code] : 500);
    return {
      __outcome: 'deny',
      status,
      message: a.message ?? `Request denied (${status})`,
      headers: a.headers,
      ...(a.code !== undefined ? { code: a.code } : {}),
      ...(a.data !== undefined ? { data: a.data } : {}),
    };
  }
  // Positional form: a string is a code, a number is a raw status.
  if (typeof a === 'string') {
    const status = DENY_CODE_STATUS[a];
    return {
      __outcome: 'deny',
      status,
      message: b ?? `Request denied (${status})`,
      headers: c?.headers,
      code: a,
      ...(c?.data !== undefined ? { data: c.data } : {}),
    };
  }
  return {
    __outcome: 'deny',
    status: a,
    message: b ?? `Request denied (${a})`,
    headers: c?.headers,
    ...(c?.data !== undefined ? { data: c.data } : {}),
  };
}

export function isOutcome(value: unknown): value is Outcome {
  if (typeof value !== 'object' || value === null) return false;
  if (!('__outcome' in value)) return false;
  const tag = (value as { __outcome: unknown }).__outcome;
  return (
    tag === 'redirect' ||
    tag === 'deny' ||
    tag === 'render' ||
    tag === 'timeout'
  );
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

export function timeoutOutcome(timeoutMs: number): TimeoutOutcome {
  return { __outcome: 'timeout', timeoutMs };
}

export function isTimeout(value: unknown): value is TimeoutOutcome {
  return isOutcome(value) && value.__outcome === 'timeout';
}
