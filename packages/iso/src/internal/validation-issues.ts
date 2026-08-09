import { VALIDATION_ISSUES_KEY } from './contract.js';

// The issue SHAPE and its reader live in this dependency-free leaf, apart from
// the schema-running half of `validate.ts`. `useAction` imports `validate.js`
// lazily on purpose (a consumer without a client `schema` should not pay for
// the validator), and the deny-envelope decode on its hot path needs the
// reader; a static import of `validate.js` from there would have quietly
// undone that split. `validate.ts` re-exports both, so it stays the one name
// callers import.

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
