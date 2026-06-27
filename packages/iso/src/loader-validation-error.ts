import type { ValidationIssue } from './validate.js';

/**
 * Thrown by the client loader RPC path when a loader's `paramsSchema` /
 * `searchSchema` validation fails, carrying the normalized field-level issues
 * the server attached to the deny envelope. This is the loader-path analogue of
 * the action path's `deny(422)` + issues: a loader failure reaches a Preact
 * error boundary as a thrown error rather than a `useActionResult()` value, so
 * the issues ride the error instead of an action result. Read them with
 * `getValidationIssues(error)` (the same reader actions use) to render
 * `<FieldError>` uniformly across both paths.
 *
 * `status` is the deny status: 400 for an invalid query string, 404 for an
 * invalid route param (the URL names no valid resource).
 */
export class LoaderValidationError extends Error {
  readonly status: number;
  readonly issues: ValidationIssue[];
  constructor(status: number, message: string, issues: ValidationIssue[]) {
    super(message);
    this.name = 'LoaderValidationError';
    this.status = status;
    this.issues = issues;
  }
}
