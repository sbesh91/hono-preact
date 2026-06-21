import type { ActionResult } from './use-action-result.js';
import type { ValidationIssue } from './validate.js';
import { VALIDATION_ISSUES_KEY } from './internal/contract.js';

/**
 * Extract normalized validation issues from an action result, or `null` when the
 * result is not a schema-validation failure. A validation failure is a `deny`
 * whose `data` carries the framework-reserved `VALIDATION_ISSUES_KEY`; this is
 * what distinguishes it from an app-level `deny`. Pair with `useActionResult`:
 *
 * ```tsx
 * const result = useActionResult(create);
 * const issues = getValidationIssues(result); // ValidationIssue[] | null
 * ```
 */
export function getValidationIssues(
  result: ActionResult<unknown, unknown>
): ValidationIssue[] | null {
  if (!result || result.kind !== 'deny') return null;
  const { data } = result;
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as Record<string, unknown>)[VALIDATION_ISSUES_KEY];
  // `data` is untrusted wire JSON: this read is the sanctioned cast boundary
  // (same class as decodeActionResponse). We assert only that it is an array.
  if (!Array.isArray(raw)) return null;
  return raw as ValidationIssue[];
}
