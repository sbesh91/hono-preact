import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ValidationIssue } from './internal/validation-issues.js';

export type { ValidationIssue };
export { readValidationIssues } from './internal/validation-issues.js';

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
