import type { StandardSchemaV1 } from '@standard-schema/spec';
import { VALIDATION_ISSUES_KEY } from './internal/contract.js';

/** A single validation problem, normalized off a Standard Schema issue. */
export type ValidationIssue = {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
};

/** Structural guard for a single normalized issue read off untrusted JSON. */
function isValidationIssue(x: unknown): x is ValidationIssue {
  if (typeof x !== 'object' || x === null) return false;
  const { path, message } = x as { path?: unknown; message?: unknown };
  return (
    Array.isArray(path) &&
    path.every((seg) => typeof seg === 'string' || typeof seg === 'number') &&
    typeof message === 'string'
  );
}

/**
 * Read the framework-reserved issues array off an untrusted `data` bag (a deny
 * payload or wire JSON). Returns the validated issues, or `null` when the key
 * is absent, the array is empty, or any element is malformed. An EMPTY array is
 * not a validation failure (no fields to report), so it returns `null` rather
 * than `[]` to keep `if (issues)` truthiness checks honest at every call site.
 * Returns a fresh array (never the live `data` reference) so a consumer that
 * mutates the result cannot reach back into the deny payload. Single source of
 * truth for both the action-result reader (`getValidationIssues`) and the
 * client loader-RPC decode (`loader-fetch`), so the two cannot drift on what
 * counts as a validation deny.
 */
export function readValidationIssues(data: unknown): ValidationIssue[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as Record<string, unknown>)[VALIDATION_ISSUES_KEY];
  // `data` is untrusted wire JSON: this read is the sanctioned cast boundary
  // (same class as decodeActionResponse).
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every(isValidationIssue)) return null;
  return raw.slice() as ValidationIssue[]; // sound: every element guarded above
}

/** Result of running a schema: the validated output or the issues. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

function normalizeKey(key: PropertyKey): string | number {
  return typeof key === 'number' ? key : String(key);
}

/**
 * Normalize Standard Schema issues into the framework's field-error shape.
 * Each path segment is either a `PropertyKey` or `{ key: PropertyKey }`; both
 * collapse to a `string | number`. Symbols stringify (form/loader keys are
 * never symbols in practice).
 */
export function normalizeIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>
): ValidationIssue[] {
  return issues.map((issue) => ({
    message: issue.message,
    path: (issue.path ?? []).map((seg) =>
      typeof seg === 'object' && seg !== null
        ? normalizeKey(seg.key)
        : normalizeKey(seg)
    ),
  }));
}

/**
 * Run a Standard Schema against `input`. Awaits async schemas. Returns a
 * discriminated result so callers branch without touching the raw spec shape.
 */
export async function validateWithSchema<S extends StandardSchemaV1>(
  schema: S,
  input: unknown
): Promise<ValidationResult<StandardSchemaV1.InferOutput<S>>> {
  let result = schema['~standard'].validate(input);
  if (result instanceof Promise) result = await result;
  // Treat a present, non-empty issues array as failure; everything else
  // (success, or a spec-violating empty issues array) is a pass.
  if (result.issues && result.issues.length > 0) {
    return { ok: false, issues: normalizeIssues(result.issues) };
  }
  // After the failure guard, the spec guarantees `value` is present.
  // `'value' in result` narrows from Result<Output> to SuccessResult<Output>
  // so no cast is needed; the empty-issues spec-violation case still carries
  // `value` and is covered by the same narrowing.
  if ('value' in result) {
    return { ok: true, value: result.value };
  }
  // Off-spec result: neither a non-empty issues array nor a value property.
  // The spec mandates that a non-failure result carries `value`, but a schema
  // could return `{ issues: [] }` (empty array, no value). We treat it as a
  // pass (empty issues = no problems) rather than blocking the form. The cast
  // is the sanctioned boundary for fabricating the absent value at this seam.
  return { ok: true, value: undefined as StandardSchemaV1.InferOutput<S> };
}

/**
 * Group normalized issues into a field-error map keyed by the dot-joined path
 * (`['address','zip'] -> "address.zip"`; an empty path -> `""`, a form-level
 * error). Used by `<Form>` and `useFieldErrors`.
 */
export function mapIssuesToFields(
  issues: ValidationIssue[] | null
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!issues) return out;
  for (const issue of issues) {
    const key = issue.path.join('.');
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Fail-open log for when a client-side schema's validate throws or rejects: the
 * request proceeds to server-side validation rather than dead-ending. Shared by
 * `<Form schema>` and `useAction({ schema })` so the message cannot drift.
 */
export function logClientSchemaThrew(err: unknown): void {
  console.error(
    'hono-preact: client schema validation threw; proceeding to server-side validation.',
    err
  );
}
