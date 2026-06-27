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
 *
 * The input is typed `unknown`: a loader error arrives off a `catch`, and an
 * action result is structurally probed below, so there is nothing to gain from
 * a narrower signature (any narrower type is a subtype of `unknown` anyway).
 */
export function getValidationIssues(input: unknown): ValidationIssue[] | null {
  // Loader path: a thrown LoaderValidationError carries already-normalized
  // issues. Return a defensive copy, and treat an empty list as no issues.
  if (input instanceof LoaderValidationError) {
    return input.issues.length > 0 ? input.issues.slice() : null;
  }
  // Action path: a deny result whose `data` carries the reserved key. Probe the
  // discriminant structurally rather than asserting an ActionResult shape that
  // was never verified.
  if (
    typeof input !== 'object' ||
    input === null ||
    (input as { kind?: unknown }).kind !== 'deny'
  ) {
    return null;
  }
  return readValidationIssues((input as { data?: unknown }).data);
}
