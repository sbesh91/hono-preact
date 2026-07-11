import { describe, it, expect, vi } from 'vitest';
import {
  normalizeSelectionProps,
  type SelectionProps,
} from '../listbox/selection.js';

describe('normalizeSelectionProps', () => {
  it('single uncontrolled: values undefined, empty defaults, no emitter', () => {
    const norm = normalizeSelectionProps<string>({});
    expect(norm.multiple).toBe(false);
    expect(norm.values).toBeUndefined();
    expect(norm.defaultValues).toEqual([]);
    expect(norm.onValuesChange).toBeUndefined();
  });

  it('single controlled: scalar wraps, null means controlled-and-empty', () => {
    expect(normalizeSelectionProps<string>({ value: 'a' }).values).toEqual([
      'a',
    ]);
    expect(normalizeSelectionProps<string>({ value: null }).values).toEqual([]);
  });

  it('single defaultValue wraps; null or absent becomes []', () => {
    expect(
      normalizeSelectionProps<string>({ defaultValue: 'a' }).defaultValues
    ).toEqual(['a']);
    expect(
      normalizeSelectionProps<string>({ defaultValue: null }).defaultValues
    ).toEqual([]);
  });

  it('single emit maps [] to null and [v] to v', () => {
    const cb = vi.fn();
    const norm = normalizeSelectionProps<string>({ onValueChange: cb });
    norm.onValuesChange?.([]);
    expect(cb).toHaveBeenLastCalledWith(null);
    norm.onValuesChange?.(['a']);
    expect(cb).toHaveBeenLastCalledWith('a');
  });

  it('multi controlled: values pass through, defaults default to []', () => {
    const norm = normalizeSelectionProps<string>({
      multiple: true,
      value: ['a', 'b'],
    });
    expect(norm.multiple).toBe(true);
    expect(norm.values).toEqual(['a', 'b']);
    expect(norm.defaultValues).toEqual([]);
  });

  it('multi emit passes a fresh mutable array through', () => {
    const cb = vi.fn();
    const norm = normalizeSelectionProps<string>({
      multiple: true,
      onValueChange: cb,
    });
    norm.onValuesChange?.(['a']);
    expect(cb).toHaveBeenLastCalledWith(['a']);
    norm.onValuesChange?.([]);
    expect(cb).toHaveBeenLastCalledWith([]);
  });

  // TypeScript's discriminated union rejects a scalar value/defaultValue
  // alongside `multiple: true` at compile time; an untyped JS caller can
  // still reach this shape at runtime, which is what these two tests
  // simulate via a cast at the untrusted-input boundary.
  it('multi mode rejects a scalar value with a sharp error, not a crash inside useListboxSelection', () => {
    const props = {
      multiple: true,
      value: 'a',
    } as unknown as SelectionProps<string>;
    expect(() => normalizeSelectionProps<string>(props)).toThrow(
      'Select/Combobox: multiple mode requires an array value'
    );
  });

  it('multi mode rejects a scalar defaultValue with a sharp error', () => {
    const props = {
      multiple: true,
      defaultValue: 'a',
    } as unknown as SelectionProps<string>;
    expect(() => normalizeSelectionProps<string>(props)).toThrow(
      'Select/Combobox: multiple mode requires an array defaultValue'
    );
  });

  it('multi mode still accepts an omitted value/defaultValue (uncontrolled)', () => {
    expect(() =>
      normalizeSelectionProps<string>({ multiple: true })
    ).not.toThrow();
  });
});
