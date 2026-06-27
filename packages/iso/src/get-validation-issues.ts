import type { ActionResult } from './use-action-result.js';
import { readValidationIssues, type ValidationIssue } from './validate.js';
import { LoaderValidationError } from './loader-validation-error.js';

/**
 * Extract normalized validation issues from an action result OR a loader
 * validation error, or `null` when the input is not a schema-validation
 * failure. For actions a validation failure is a `deny` whose `data` carries
 * the framework-reserved `VALIDATION_ISSUES_KEY`; for loaders it is a thrown
 * `LoaderValidationError` (the loader path reaches an error boundary rather
 * than a `useActionResult()` value). One reader serves both so field errors
 * render identically:
 *
 * ```tsx
 * // action
 * const issues = getValidationIssues(useActionResult(create));
 * // loader (inside an error boundary)
 * const issues = getValidationIssues(error);
 * ```
 */
export function getValidationIssues(
  result: ActionResult<unknown, unknown>
): ValidationIssue[] | null;
export function getValidationIssues(error: unknown): ValidationIssue[] | null;
export function getValidationIssues(
  input: ActionResult<unknown, unknown> | unknown
): ValidationIssue[] | null {
  // Loader path: a thrown LoaderValidationError carries already-normalized
  // issues; surface them directly.
  if (input instanceof LoaderValidationError) return input.issues;
  // Action path: a deny result whose `data` carries the reserved key.
  const result = input as ActionResult<unknown, unknown> | null | undefined;
  if (!result || result.kind !== 'deny') return null;
  return readValidationIssues(result.data);
}
