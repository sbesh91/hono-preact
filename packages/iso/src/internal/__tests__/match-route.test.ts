import { describe, it, expect } from 'vitest';
import { matchRouteParams } from '../match-route.js';

describe('matchRouteParams', () => {
  it('captures params on an exact match', () => {
    expect(matchRouteParams('/projects/p1', '/projects/:projectId', true)).toEqual(
      { projectId: 'p1' }
    );
  });

  it('returns null when a descendant path does not match in exact mode', () => {
    expect(
      matchRouteParams('/projects/p1/tasks/t1', '/projects/:projectId', true)
    ).toBeNull();
  });

  it('captures the shallow params for a descendant path in non-exact mode', () => {
    expect(
      matchRouteParams('/projects/p1/tasks/t1', '/projects/:projectId', false)
    ).toMatchObject({ projectId: 'p1' });
  });

  it('returns null for an unrelated path even in non-exact mode', () => {
    expect(matchRouteParams('/other/x', '/projects/:projectId', false)).toBeNull();
  });
});
