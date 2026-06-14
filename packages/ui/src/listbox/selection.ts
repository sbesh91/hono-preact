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

export interface UseListboxSelectionOptions<Value> {
  value: Value | Value[] | undefined;
  setValue: (next: Value | Value[]) => void;
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
    value,
    setValue,
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

  const valuesArray = useCallback((): unknown[] => {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }, [value]);

  const isSelected = useCallback(
    (optionValue: unknown) => valuesArray().some((v) => equal(v, optionValue)),
    [valuesArray, equal]
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
      if (multiple) {
        const current = valuesArray();
        const next = current.some((v) => equal(v, optionValue))
          ? current.filter((v) => !equal(v, optionValue))
          : [...current, optionValue];
        setValue(next as Value[]);
      } else {
        setValue(optionValue as Value);
        setOpen(false);
      }
    },
    [snapshotLabel, multiple, valuesArray, equal, setValue, setOpen]
  );

  const selectedLabels = useCallback(
    () =>
      registry.current.filter((e) => isSelected(e.value)).map((e) => e.label),
    [isSelected, version]
  );

  const selectedItems = useCallback((): OptionEntry[] => {
    return valuesArray().map((v) => {
      const entry = registry.current.find((e) => equal(e.value, v));
      return {
        id: entry?.id ?? serialize(v),
        value: v,
        label: labelFor(v),
      };
    });
  }, [valuesArray, equal, serialize, labelFor, version]);

  const hiddenFields: ComponentChild[] | null =
    name == null
      ? null
      : valuesArray().map((v, i) =>
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
