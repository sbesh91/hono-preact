// packages/ui/src/select/select.tsx
import { h, type ComponentChildren, type JSX, type VNode } from 'preact';
import { useCallback, useId, useMemo, useRef, useState } from 'preact/hooks';
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { SelectContext, useSelectContext } from './context.js';

interface OptionEntry {
  id: string;
  value: unknown;
  label: string;
}

export interface SelectRootProps<Value = string> {
  value?: Value | Value[];
  defaultValue?: Value | Value[];
  onValueChange?: (value: Value | Value[]) => void;
  multiple?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  isValueEqual?: (a: Value, b: Value) => boolean;
  serializeValue?: (value: Value) => string;
  side?: Side; // default 'bottom'
  align?: Align; // default 'start'
  offset?: number; // default 8
  loop?: boolean; // default true
  typeahead?: boolean; // default true
  children?: ComponentChildren;
}

export function SelectRoot<Value = string>(props: SelectRootProps<Value>) {
  const {
    value: valueProp,
    defaultValue,
    onValueChange,
    multiple = false,
    open: openProp,
    defaultOpen,
    onOpenChange,
    disabled = false,
    required = false,
    isValueEqual,
    side = 'bottom',
    align = 'start',
    offset = 8,
    loop = true,
    typeahead = true,
    children,
  } = props;

  const emptyDefault = (multiple ? [] : undefined) as
    | Value
    | Value[]
    | undefined;
  const [value, setValue] = useControllableState<Value | Value[] | undefined>({
    value: valueProp,
    defaultValue: defaultValue ?? emptyDefault,
    onChange: (v) => v !== undefined && onValueChange?.(v),
  });

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const anchorRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const listboxRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLElement>(null);
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const listboxId = `${baseId}-listbox`;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState<PositionState>({
    side,
    align,
    arrowX: null,
    arrowY: null,
  });

  // The comparator is the one place the generic is re-applied. Object.is
  // accepts unknowns; a user comparator is adapted here (the sole
  // generic-erasure boundary of the component).
  const equal = useCallback(
    (a: unknown, b: unknown): boolean => {
      if (!isValueEqual) return Object.is(a, b);
      return isValueEqual(a as Value, b as Value);
    },
    [isValueEqual]
  );

  const valuesArray = useCallback((): unknown[] => {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  }, [value]);

  const isSelected = useCallback(
    (optionValue: unknown) => valuesArray().some((v) => equal(v, optionValue)),
    [valuesArray, equal]
  );

  const toggle = useCallback(
    (optionValue: unknown) => {
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
    [multiple, valuesArray, equal, setValue, setOpen]
  );

  const registry = useRef<OptionEntry[]>([]);
  const [, force] = useState(0);
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
  const selectedLabels = useCallback(
    () =>
      registry.current.filter((e) => isSelected(e.value)).map((e) => e.label),
    [isSelected]
  );

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      multiple,
      isSelected,
      toggle,
      activeId,
      setActiveId,
      registerOption,
      selectedLabels,
      anchorRef,
      floatingRef,
      listboxRef,
      arrowRef,
      triggerId,
      listboxId,
      disabled,
      required,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
      setPosition,
    }),
    [
      open,
      setOpen,
      multiple,
      isSelected,
      toggle,
      activeId,
      registerOption,
      selectedLabels,
      baseId,
      disabled,
      required,
      side,
      align,
      offset,
      loop,
      typeahead,
      position,
    ]
  );

  return h(SelectContext.Provider, { value: ctx }, children);
}

export type SelectTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function SelectTrigger(props: SelectTriggerProps): VNode {
  const { render, children, onClick, onKeyDown, ...rest } = props;
  const ctx = useSelectContext('Trigger');

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (ctx.disabled) return;
    ctx.setOpen(!ctx.open);
  };
  const handleKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>
  ) => {
    onKeyDown?.(event);
    if (ctx.disabled || event.defaultPrevented) return;
    if (
      !ctx.open &&
      (event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' ')
    ) {
      event.preventDefault();
      ctx.setOpen(true);
    }
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.anchorRef,
      type: 'button',
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': ctx.open,
      'aria-controls': ctx.listboxId,
      'aria-activedescendant': ctx.open
        ? (ctx.activeId ?? undefined)
        : undefined,
      'aria-required': ctx.required ? true : undefined,
      id: ctx.triggerId,
      disabled: ctx.disabled,
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
      onKeyDown: handleKeyDown,
    },
    state: { open: ctx.open },
    children,
  });
}

export type SelectValueProps = {
  placeholder?: string;
  render?: RenderProp<{ selectedLabels: string[] }>;
  children?: (value: { selectedLabels: string[] }) => ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'children'>;

export function SelectValue(props: SelectValueProps): VNode {
  const { placeholder, render, children, ...rest } = props;
  const ctx = useSelectContext('Value');
  const labels = ctx.selectedLabels();
  const display = labels.length > 0 ? labels.join(', ') : (placeholder ?? '');
  const content = children ? children({ selectedLabels: labels }) : display;
  return useRender<{ selectedLabels: string[] }>({
    render,
    defaultTag: 'span',
    props: {
      ...rest,
      'data-placeholder': labels.length === 0 ? '' : undefined,
    },
    state: { selectedLabels: labels },
    children: content,
  });
}
