// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { useForceUpdate } from '../use-force-update.js';

describe('useForceUpdate', () => {
  it('returns a stable callback that triggers a re-render', () => {
    let renders = 0;
    let force!: () => void;
    function Probe() {
      renders++;
      force = useForceUpdate();
      return null;
    }
    render(<Probe />);
    expect(renders).toBe(1);
    const first = force;
    act(() => force());
    expect(renders).toBe(2);
    expect(force).toBe(first); // stable identity across renders
    cleanup();
  });
});
