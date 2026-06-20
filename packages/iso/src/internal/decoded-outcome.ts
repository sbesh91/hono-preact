import { assignSafeRedirect } from './safe-redirect.js';
import { timeoutMessage } from './timeout.js';
import type { DecodedEnvelope } from './action-envelope.js';

/**
 * The message surfaced when a `redirect()` outcome targets another origin.
 * Verbatim in both action consumers; one source so a reword cannot desync.
 */
export function crossOriginRedirectMessage(to: string): string {
  return `Refused cross-origin redirect to ${to}. redirect() must target a same-origin path (e.g. "/dashboard"), not an absolute URL to another origin.`;
}

/**
 * Consumer-supplied handlers for each decoded action outcome. The two callers
 * (`useAction`, `<Form>`) diverge in their side effects AND control flow
 * (useAction throws failures to a surrounding catch; `<Form>` records a result
 * and returns; `malformed` reloads vs throws), so that all lives in the sink.
 * `applyDecodedOutcome` owns only what IS shared: the dispatch over the seven
 * kinds, the same-origin redirect attempt, and the canonical messages.
 */
export interface OutcomeSink {
  /** Envelope reported `success`; `data` is the raw decoded result. */
  success(data: unknown): void;
  /** A same-origin redirect was issued; navigation is underway. */
  navigated(): void;
  /** A redirect targeted another origin and was refused. */
  crossOriginRedirect(message: string): void;
  deny(status: number, message: string, data: unknown): void;
  error(message: string): void;
  /** `message` is the canonical timed-out wording for `timeoutMs`. */
  timeout(timeoutMs: number, message: string): void;
  unknown(outcome: string | undefined, message: string | undefined): void;
  /** The body was not an envelope (HTTP status carried for diagnostics). */
  malformed(httpStatus: number): void;
}

/**
 * Dispatch a decoded action envelope to a consumer's {@link OutcomeSink}.
 * Returns `true` when a same-origin redirect was issued, so the caller can stop
 * (useAction parks on a never-settling promise; `<Form>` falls through to its
 * `finally`). Failure handling — throw or record-and-return — is entirely the
 * sink's, as is the `malformed` policy.
 */
export function applyDecodedOutcome(
  decoded: DecodedEnvelope,
  sink: OutcomeSink
): boolean {
  switch (decoded.kind) {
    case 'success':
      sink.success(decoded.data);
      return false;
    case 'redirect':
      if (assignSafeRedirect(decoded.to)) {
        sink.navigated();
        return true;
      }
      sink.crossOriginRedirect(crossOriginRedirectMessage(decoded.to));
      return false;
    case 'deny':
      sink.deny(decoded.status, decoded.message, decoded.data);
      return false;
    case 'error':
      sink.error(decoded.message);
      return false;
    case 'timeout':
      sink.timeout(decoded.timeoutMs, timeoutMessage(decoded.timeoutMs));
      return false;
    case 'unknown':
      sink.unknown(decoded.outcome, decoded.message);
      return false;
    case 'malformed':
      sink.malformed(decoded.httpStatus);
      return false;
    default:
      decoded satisfies never;
      return false;
  }
}
