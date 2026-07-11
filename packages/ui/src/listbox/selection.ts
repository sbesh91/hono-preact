// packages/ui/src/listbox/selection.ts
import { h, type ComponentChild } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

// An option-disabled-aware selector both Select and Combobox query the listbox
// with. Lives here so both slices share one definition.
export const OPTION_SELECTOR = '[role="option"]:not([aria-disabled="true"])';

export interface OptionEntry<Value = unknown> {
  id: string;
  value: Value;
  label: string;
}

// Shared controlled/uncontrolled selection props for Select + Combobox Roots,
// discriminated on `multiple`. Single mode deals in `Value | null` (`null` is
// controlled-and-empty), multiple mode deals in arrays (`[]` is
// controlled-and-empty). `undefined` keeps meaning "uncontrolled" in both
// arms. The generic stays on each Root (both default Value = string).
export interface SingleSelectionProps<Value> {
  multiple?: false;
  /** Controlled value; `null` = controlled-and-empty; omit for uncontrolled. */
  value?: Value | null;
  defaultValue?: Value | null;
  onValueChange?: (value: Value | null) => void;
}

export interface MultipleSelectionProps<Value> {
  multiple: true;
  /** Controlled values; `[]` = controlled-and-empty; omit for uncontrolled. */
  value?: readonly Value[];
  defaultValue?: readonly Value[];
  onValueChange?: (value: Value[]) => void;
}

export type SelectionProps<Value> =
  | SingleSelectionProps<Value>
  | MultipleSelectionProps<Value>;

// The uniform internal shape both Roots feed to useControllableState:
// selection state is always an array. `values` is undefined only when
// uncontrolled; a cleared single select (`value={null}`) and a cleared multi
// select (`value={[]}`) both normalize to [].
export interface NormalizedSelection<Value> {
  multiple: boolean;
  values: readonly Value[] | undefined;
  defaultValues: readonly Value[];
  onValuesChange: ((next: readonly Value[]) => void) | undefined;
}

// Pure: wraps the public callback so single mode emits `Value | null`
// ([] -> null) and multiple mode emits a fresh mutable Value[]. Narrowing on
// `p.multiple` discriminates the union, so no casts are needed. Factored out
// of normalizeSelectionProps so useStableOnValuesChange below can rebuild it
// from a ref-read snapshot of props without needing normalizeSelectionProps's
// own (differently-keyed) memoization.
function wrapOnValueChange<Value>(
  p: SelectionProps<Value>
): ((next: readonly Value[]) => void) | undefined {
  if (p.multiple) {
    const cb = p.onValueChange;
    return cb === undefined ? undefined : (next) => cb([...next]);
  }
  const cb = p.onValueChange;
  return cb === undefined
    ? undefined
    : (next) => cb(next.length > 0 ? next[0] : null);
}

// Pure: maps the public discriminated props onto the internal array shape.
// Narrowing on `p.multiple` discriminates the union, so no casts are needed.
// Callers memoize the result on `[multiple, value, defaultValue]` only
// (excluding onValueChange): the fresh wrapper array a single-mode `value`
// produces would otherwise churn downstream callback identities every
// render, and an inline onValueChange handler would defeat that
// memoization since it mints a fresh identity every render. Use
// useStableOnValuesChange for the callback instead.
export function normalizeSelectionProps<Value>(
  p: SelectionProps<Value>
): NormalizedSelection<Value> {
  if (p.multiple) {
    return {
      multiple: true,
      values: p.value,
      defaultValues: p.defaultValue ?? [],
      onValuesChange: wrapOnValueChange(p),
    };
  }
  return {
    multiple: false,
    values:
      p.value === undefined ? undefined : p.value === null ? [] : [p.value],
    defaultValues: p.defaultValue == null ? [] : [p.defaultValue],
    onValuesChange: wrapOnValueChange(p),
  };
}

// Hook: a referentially-stable onValuesChange wrapper for the Roots'
// useControllableState call. Reads the latest props (including
// `onValueChange`) through a ref on every render, updated in a layout effect
// -- the same pattern useControllableState uses for its own onChange ref --
// so the returned callback's identity never changes. This is what lets the
// Roots memoize normalizeSelectionProps's values/defaultValues on
// `[multiple, value, defaultValue]` alone: the callback no longer needs to be
// part of that memo to stay fresh.
export function useStableOnValuesChange<Value>(
  props: SelectionProps<Value>
): (next: readonly Value[]) => void {
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });
  return useCallback((next: readonly Value[]) => {
    wrapOnValueChange(propsRef.current)?.(next);
  }, []);
}

export interface UseListboxSelectionOptions<Value> {
  values: readonly Value[];
  setValues: (next: Value[]) => void;
  multiple: boolean;
  setOpen: (open: boolean) => void;
  isValueEqual?: (a: Value, b: Value) => boolean;
  serializeValue?: (value: Value) => string;
  itemToString?: (value: Value) => string;
  name?: string;
  disabled?: boolean;
}

export interface ListboxSelection {
  isSelected: (optionValue: unknown) => boolean;
  toggle: (optionValue: unknown) => void;
  registerOption: (id: string, value: unknown, label: string) => () => void;
  // Selected option labels in DOM order (registry order); used by Select.Value.
  selectedLabels: () => string[];
  // Selected options in value order, with labels resolved via registry, then
  // the value-to-label cache, then itemToString; used by Combobox chips.
  selectedItems: () => OptionEntry[];
  // Resolve a single value's display label (registry -> cache -> itemToString
  // -> serialized fallback).
  labelFor: (value: unknown) => string;
  optionCount: number; // number of currently-registered options
  hiddenFields: ComponentChild[] | null;
}

export function useListboxSelection<Value = string>(
  opts: UseListboxSelectionOptions<Value>
): ListboxSelection {
  const {
    values,
    setValues,
    multiple,
    setOpen,
    isValueEqual,
    serializeValue,
    itemToString,
    name,
    disabled = false,
  } = opts;

  // The comparator is the one place the generic is re-applied (Object.is
  // accepts unknowns; a user comparator is adapted here).
  const equal = useCallback(
    (a: unknown, b: unknown): boolean =>
      isValueEqual ? isValueEqual(a as Value, b as Value) : Object.is(a, b),
    [isValueEqual]
  );
  const serialize = useCallback(
    (v: unknown): string =>
      serializeValue ? serializeValue(v as Value) : String(v),
    [serializeValue]
  );
  const toLabel = useCallback(
    (v: unknown): string | undefined =>
      itemToString ? itemToString(v as Value) : undefined,
    [itemToString]
  );

  const isSelected = useCallback(
    (optionValue: unknown) => values.some((v) => equal(v, optionValue)),
    [values, equal]
  );

  const registry = useRef<OptionEntry[]>([]);
  // `version` bumps on every registry mutation. The registry lives in a ref, so
  // the callbacks that read it (registryLabelFor/selectedLabels/selectedItems)
  // must list `version` as a dep, or their identity would never change and the
  // consuming Root's context memo (keyed on those callbacks) would never
  // recompute, leaving a stale auto-label after an add/remove/text change.
  const [version, force] = useState(0);
  const registerOption = useCallback(
    (id: string, optionValue: unknown, label: string) => {
      registry.current = [
        ...registry.current,
        { id, value: optionValue, label },
      ];
      force((n) => n + 1);
      return () => {
        registry.current = registry.current.filter((e) => e.id !== id);
        force((n) => n + 1);
      };
    },
    []
  );

  // value-to-label cache, keyed by serialized value. Snapshotted at selection
  // time so a label survives its option being filtered out of the DOM.
  const labelCache = useRef<Map<string, string>>(new Map());

  const registryLabelFor = useCallback(
    (v: unknown): string | undefined =>
      registry.current.find((e) => equal(e.value, v))?.label,
    [equal, version]
  );

  const snapshotLabel = useCallback(
    (v: unknown) => {
      const fromRegistry = registryLabelFor(v);
      if (fromRegistry !== undefined) {
        labelCache.current.set(serialize(v), fromRegistry);
      }
    },
    [registryLabelFor, serialize]
  );

  const labelFor = useCallback(
    (v: unknown): string => {
      const fromRegistry = registryLabelFor(v);
      if (fromRegistry !== undefined) return fromRegistry;
      const cached = labelCache.current.get(serialize(v));
      if (cached !== undefined) return cached;
      const fromItemToString = toLabel(v);
      if (fromItemToString !== undefined) return fromItemToString;
      return serialize(v);
    },
    [registryLabelFor, serialize, toLabel]
  );

  const toggle = useCallback(
    (optionValue: unknown) => {
      snapshotLabel(optionValue);
      // The module-level context erases the per-instance generic to unknown;
      // the Root owns the generic, so re-apply it at this one confined seam
      // (mirrors Combobox.Value).
      const picked = optionValue as Value;
      if (multiple) {
        const next = values.some((v) => equal(v, picked))
          ? values.filter((v) => !equal(v, picked))
          : [...values, picked];
        setValues(next);
      } else {
        setValues([picked]);
        setOpen(false);
      }
    },
    [snapshotLabel, multiple, values, equal, setValues, setOpen]
  );

  const selectedLabels = useCallback(
    () =>
      registry.current.filter((e) => isSelected(e.value)).map((e) => e.label),
    [isSelected, version]
  );

  const selectedItems = useCallback((): OptionEntry[] => {
    return values.map((v) => {
      const entry = registry.current.find((e) => equal(e.value, v));
      return {
        id: entry?.id ?? serialize(v),
        value: v,
        label: labelFor(v),
      };
    });
  }, [values, equal, serialize, labelFor, version]);

  const hiddenFields: ComponentChild[] | null =
    name == null
      ? null
      : values.map((v, i) =>
          h('input', {
            key: `${name}-${i}`,
            type: 'hidden',
            name,
            value: serialize(v),
            disabled: disabled || undefined,
          })
        );

  return {
    isSelected,
    toggle,
    registerOption,
    selectedLabels,
    selectedItems,
    labelFor,
    optionCount: registry.current.length,
    hiddenFields,
  };
}

// Shared by Select.Option and Combobox.Option: register an option's label with
// the listbox registry on mount, re-register when its identity/label changes,
// and deregister on unmount. For non-string children stringLabel is undefined
// and the label is read from the element's textContent at effect time (post-
// mount), matching the original per-component behavior.
export function useRegisterOption(
  register: (id: string, value: unknown, label: string) => () => void,
  id: string,
  value: unknown,
  stringLabel: string | undefined
): void {
  useLayoutEffect(() => {
    const label = stringLabel ?? document.getElementById(id)?.textContent ?? '';
    return register(id, value, label);
  }, [id, value, stringLabel, register]);
}
