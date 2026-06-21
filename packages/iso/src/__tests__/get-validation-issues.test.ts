import { describe, expect, it } from 'vitest';
import { getValidationIssues } from '../get-validation-issues.js';
import { VALIDATION_ISSUES_KEY } from '../internal/contract.js';

describe('getValidationIssues', () => {
  it('returns the issues array from a validation deny', () => {
    const issues = [{ path: ['title'], message: 'Required' }];
    const result = {
      kind: 'deny' as const,
      status: 422,
      message: 'Validation failed',
      data: { [VALIDATION_ISSUES_KEY]: issues },
      submittedPayload: {},
    };
    expect(getValidationIssues(result)).toEqual(issues);
  });

  it('returns null when the issues array contains non-conforming elements', () => {
    const result = {
      kind: 'deny' as const,
      status: 403,
      message: 'Forbidden',
      data: { [VALIDATION_ISSUES_KEY]: ['garbage', 42] },
      submittedPayload: {},
    };
    expect(getValidationIssues(result)).toBeNull();
  });

  it('returns null for a non-validation deny (app-level)', () => {
    const result = {
      kind: 'deny' as const,
      status: 403,
      message: 'Forbidden',
      data: { reason: 'unauthorized' },
      submittedPayload: {},
    };
    expect(getValidationIssues(result)).toBeNull();
  });

  it('returns null for success / error / null results', () => {
    expect(getValidationIssues(null)).toBeNull();
    expect(
      getValidationIssues({ kind: 'success', data: {}, submittedPayload: {} })
    ).toBeNull();
    expect(
      getValidationIssues({
        kind: 'error',
        message: 'boom',
        submittedPayload: null,
      })
    ).toBeNull();
  });
});
