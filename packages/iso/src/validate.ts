import type { StandardSchemaV1 } from '@standard-schema/spec';

/** A single validation problem, normalized off a Standard Schema issue. */
export type ValidationIssue = {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
};

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
  const raw = schema['~standard'].validate(input);
  const resolved = raw instanceof Promise ? await raw : raw;
  if (resolved.issues && resolved.issues.length > 0) {
    return { ok: false, issues: normalizeIssues(resolved.issues) };
  }
  // `resolved.issues` is absent or empty: treat as success. A schema returning
  // `{ issues: [] }` violates the spec but must not be misclassified as failure.
  if (!resolved.issues) {
    return { ok: true, value: resolved.value };
  }
  // Empty-issues case: spec violation; extract value without narrowing gap.
  return {
    ok: true,
    value: (resolved as unknown as { value: StandardSchemaV1.InferOutput<S> })
      .value,
  };
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
