// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useDescriptionRegistry } from '../use-description-registry.js';

afterEach(cleanup);

describe('useDescriptionRegistry', () => {
  it('hasDescription is false until something registers, true while registered', () => {
    let registry: ReturnType<typeof useDescriptionRegistry> | undefined;
    function Probe() {
      registry = useDescriptionRegistry();
      return <span data-testid="has">{String(registry.hasDescription)}</span>;
    }
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('has').textContent).toBe('false');

    let unregister: () => void = () => {};
    act(() => {
      unregister = registry!.registerDescription();
    });
    expect(getByTestId('has').textContent).toBe('true');

    act(() => {
      unregister();
    });
    expect(getByTestId('has').textContent).toBe('false');
  });

  it('counts multiple registrations (stays true until all unregister)', () => {
    let registry: ReturnType<typeof useDescriptionRegistry> | undefined;
    function Probe() {
      registry = useDescriptionRegistry();
      return <span data-testid="has">{String(registry.hasDescription)}</span>;
    }
    const { getByTestId } = render(<Probe />);
    let a: () => void = () => {};
    let b: () => void = () => {};
    act(() => {
      a = registry!.registerDescription();
      b = registry!.registerDescription();
    });
    expect(getByTestId('has').textContent).toBe('true');
    act(() => a());
    expect(getByTestId('has').textContent).toBe('true');
    act(() => b());
    expect(getByTestId('has').textContent).toBe('false');
  });
});
