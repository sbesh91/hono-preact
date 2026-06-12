// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useNavigate, type NavigateOptions } from '../use-navigate.js';

const mockRoute = vi.fn();
vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useLocation: () => ({ route: mockRoute }) };
});

beforeEach(() => mockRoute.mockClear());
afterEach(cleanup);

function Harness({ path, options }: { path: string; options?: NavigateOptions }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(path, options)}>go</button>;
}

function click() {
  document.querySelector('button')!.click();
}

describe('useNavigate', () => {
  it('soft-navigates via route() with replace=false by default', () => {
    render(<Harness path="/x" />);
    click();
    expect(mockRoute).toHaveBeenCalledWith('/x', false);
  });

  it('passes replace through to route()', () => {
    render(<Harness path="/x" options={{ replace: true }} />);
    click();
    expect(mockRoute).toHaveBeenCalledWith('/x', true);
  });

  it('reload does a hard navigation and does NOT soft-navigate', () => {
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => {});
    render(<Harness path="/x" options={{ reload: true }} />);
    click();
    expect(assign).toHaveBeenCalledWith('/x');
    expect(mockRoute).not.toHaveBeenCalled();
    assign.mockRestore();
  });
});
