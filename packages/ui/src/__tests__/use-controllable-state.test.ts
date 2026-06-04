// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useControllableState } from '../use-controllable-state.js';

describe('useControllableState', () => {
  it('is uncontrolled when value is undefined: setter updates state and calls onChange', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useControllableState<boolean>({ defaultValue: false, onChange })
    );
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is controlled when value is provided: reads value, does not self-update', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useControllableState<boolean>({
        value: true,
        defaultValue: false,
        onChange,
      })
    );
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(true);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('returns a stable setter across renders', () => {
    const { result, rerender } = renderHook(() =>
      useControllableState<number>({ defaultValue: 0 })
    );
    const first = result.current[1];
    rerender();
    expect(result.current[1]).toBe(first);
  });
});
