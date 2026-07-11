// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import { useMemo } from 'preact/hooks';
import {
  normalizeSelectionProps,
  useStableOnValuesChange,
  type SelectionProps,
} from '../listbox/selection.js';

// Mirrors the exact usage pattern in Select.Root / Combobox.Root: `values`/
// `defaultValues` come from normalizeSelectionProps, memoized on
// [multiple, value, defaultValue] only; the callback comes from
// useStableOnValuesChange instead of the memo. A parent that re-renders with
// a fresh inline onValueChange each time must not churn either.
function useRootSelectionPattern<Value>(props: SelectionProps<Value>) {
  const norm = useMemo(
    () => normalizeSelectionProps<Value>(props),
    [props.multiple, props.value, props.defaultValue]
  );
  const onValuesChange = useStableOnValuesChange<Value>(props);
  return {
    values: norm.values,
    defaultValues: norm.defaultValues,
    onValuesChange,
  };
}

describe('Select/Combobox Root selection memoization', () => {
  it('keeps `values` identity stable across a re-render that only swaps the inline onValueChange', () => {
    const { result, rerender } = renderHook(
      (props: SelectionProps<string>) => useRootSelectionPattern(props),
      { initialProps: { value: 'a', onValueChange: () => {} } }
    );
    const firstValues = result.current.values;
    rerender({ value: 'a', onValueChange: () => {} }); // fresh identity each render
    expect(result.current.values).toBe(firstValues);
  });

  it('keeps `defaultValues` identity stable across a re-render that only swaps the inline onValueChange', () => {
    const { result, rerender } = renderHook(
      (props: SelectionProps<string>) => useRootSelectionPattern(props),
      { initialProps: { defaultValue: 'a', onValueChange: () => {} } }
    );
    const firstDefaults = result.current.defaultValues;
    rerender({ defaultValue: 'a', onValueChange: () => {} });
    expect(result.current.defaultValues).toBe(firstDefaults);
  });
});

describe('useStableOnValuesChange', () => {
  it('returns a referentially stable callback across renders, even with a fresh inline onValueChange each time', () => {
    const { result, rerender } = renderHook(
      (props: SelectionProps<string>) => useStableOnValuesChange(props),
      { initialProps: { value: 'a', onValueChange: () => {} } }
    );
    const first = result.current;
    rerender({ value: 'a', onValueChange: () => {} });
    expect(result.current).toBe(first);
  });

  it('still calls the latest onValueChange, not a stale one captured on first render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      (props: SelectionProps<string>) => useStableOnValuesChange(props),
      { initialProps: { value: 'a', onValueChange: first } }
    );
    rerender({ value: 'a', onValueChange: second });
    result.current(['b']);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('b');
  });

  it('maps single mode [] -> null and multiple mode passes the array through', () => {
    const single = vi.fn();
    const { result: singleResult } = renderHook(
      (props: SelectionProps<string>) => useStableOnValuesChange(props),
      { initialProps: { onValueChange: single } }
    );
    singleResult.current([]);
    expect(single).toHaveBeenCalledWith(null);

    const multi = vi.fn();
    const { result: multiResult } = renderHook(
      (props: SelectionProps<string>) => useStableOnValuesChange(props),
      { initialProps: { multiple: true, onValueChange: multi } }
    );
    multiResult.current(['a', 'b']);
    expect(multi).toHaveBeenCalledWith(['a', 'b']);
  });
});
