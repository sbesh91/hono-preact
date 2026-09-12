import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
  VALIDATION_FAILED_MESSAGE,
  VALIDATION_ISSUES_KEY,
} from './contract.js';
import type { ValidationIssue } from './validation-issues.js';
import type { ValidationResult } from '../validate.js';
import type { ActionOutcomeRecorder } from './action-outcome-recorder.js';

/**
 * What the client-side schema gate decided.
 *
 * `proceed` is the only arm that lets `mutate` continue; the other two are
 * terminal and carry everything the caller needs to build its `MutateResult`.
 * A union rather than a nullable so the aborted and denied cases stay distinct
 * -- they settle to different `kind`s and only one of them sets error state.
 */
export type SchemaGateDecision =
  | { kind: 'proceed' }
  | { kind: 'aborted' }
  | { kind: 'denied'; message: string; issues: ValidationIssue[] };

/**
 * Reject a known-invalid payload before any side effect: no `onMutate`, no
 * optimistic entry, no request. The rejection is surfaced as the same
 * deny(422)+issues the server produces, so a caller cannot tell which side
 * caught it -- that parity is the point, and it is why this records a deny
 * outcome rather than a plain error.
 *
 * Fails **open** at every level. A schema that throws, and even a `validate.js`
 * chunk that will not load at all, must not block the request: the server
 * validates authoritatively, so the worst case of failing open is one wasted
 * round-trip, while failing closed would make an unrelated loading fault look
 * like a validation error the user cannot fix.
 *
 * `pending` never flips true on this path, and no request is ever in flight,
 * which is what makes the aborted arm unconditional below.
 *
 * The caller must not enter this gate with an already-aborted signal: an abort
 * that predates the mutate belongs on the request path, which unwinds it
 * through the normal in-flight machinery. This handles only an abort that
 * lands *during* validation.
 */
export async function runSchemaGate<TPayload>(options: {
  schema: StandardSchemaV1<unknown, TPayload>;
  payload: TPayload;
  signal: AbortSignal | undefined;
  recorder: ActionOutcomeRecorder;
}): Promise<SchemaGateDecision> {
  const { schema, payload, signal, recorder } = options;

  let validated: ValidationResult<TPayload> | undefined;
  try {
    // Only a schema-using mutate needs validate.js; import it lazily to
    // keep it out of the base useAction chunk (mirrors the sse-decoder
    // import). Fail open if the chunk itself cannot load: the server
    // validates authoritatively, so a validator that will not load must
    // not block the request.
    const { validateWithSchema, logClientSchemaThrew } =
      await import('../validate.js');
    try {
      validated = await validateWithSchema(schema, payload);
    } catch (err) {
      logClientSchemaThrew(err);
    }
  } catch {
    // validate.js failed to load; fail open (validated stays undefined).
  }

  // If the caller aborted while an async schema was validating, the mutate is
  // cancelled: do not record a deny or flip error state (mirrors the request
  // path's post-await abort guard). A cold gate has no request in flight and
  // no local `denied`, so there is nothing that could have already decided a
  // deny -- this is unconditionally the aborted arm.
  if (signal?.aborted) return { kind: 'aborted' };

  if (validated && !validated.ok) {
    recorder.deny({
      status: 422,
      message: VALIDATION_FAILED_MESSAGE,
      data: { [VALIDATION_ISSUES_KEY]: validated.issues },
    });
    return {
      kind: 'denied',
      message: VALIDATION_FAILED_MESSAGE,
      issues: validated.issues,
    };
  }

  return { kind: 'proceed' };
}
