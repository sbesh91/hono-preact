// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useParams } from '../use-params.js';

const mockRoute = {
  path: '/demo/projects/p1',
  searchParams: {},
  pathParams: {} as Record<string, string>,
};
vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useRoute: () => mockRoute };
});

afterEach(cleanup);

function Harness({ onParams }: { onParams: (p: unknown) => void }) {
  const params = useParams('/demo/projects/:projectId');
  onParams(params);
  return null;
}

describe('useParams', () => {
  it('returns the live route pathParams for the named route', () => {
    mockRoute.pathParams = { projectId: 'p1' };
    let seen: unknown;
    render(<Harness onParams={(p) => (seen = p)} />);
    expect(seen).toEqual({ projectId: 'p1' });
  });
});
