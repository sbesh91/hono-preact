// packages/ui/src/select/select.tsx
import {
  h,
  Fragment,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import { useId, useMemo, useRef, useState } from 'preact/hooks';
import { renderElement, type RenderProp } from '../render-element.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align, PositioningProps } from '../use-position.js';
import { Positioner } from '../positioner.js';
import { useDismiss } from '../use-dismiss.js';
import {
  useListNavigation,
  useHighlightSelectedOnOpen,
} from '../list-navigation.js';
import {
  useListboxSelection,
  useRegisterOption,
  normalizeSelectionProps,
  useStableOnValuesChange,
  OPTION_SELECTOR,
  type SelectionProps,
} from '../listbox/selection.js';
import { useFormReset } from '../use-form-reset.js';
import { SelectContext, useSelectContext } from './context.js';

export interface SelectRootOwnProps extends PositioningProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  loop?: boolean; // default true
  typeahead?: boolean; // default true
  children?: ComponentChildren;
}

// An intersection with the SelectionProps union rather than an interface
// (interfaces cannot extend a union). `multiple` discriminates the value
// shape: single mode deals in `Value | null`, multiple mode in arrays.
// `Value extends {}` keeps null out of Value so null-as-empty is unambiguous.
export type SelectRootProps<Value extends {} = string> = SelectRootOwnProps &
  SelectionProps<Value> & {
    isValueEqual?: (a: Value, b: Value) => boolean;
    serializeValue?: (value: Value) => string;
  };

export function SelectRoot<Value extends {} = string>(
  props: SelectRootProps<Value>
) {
  const {
    open: openProp,
    defaultOpen,
    onOpenChange,
    name,
    disabled = false,
    required = false,
    isValueEqual,
    serializeValue,
    side = 'bottom',
    align = 'start',
    offset = 8,
    loop = true,
    typeahead = true,
    children,
  } = props;

  // Destructuring the selection props would lose the `multiple` discriminant
  // correlation, so they go to the normalizer whole. Memoized on the
  // value-shape props only (not onValueChange): an inline handler mints a
  // fresh identity every render, and including it here would recompute
  // `values`/`defaultValues` (and churn everything keyed on them) on every
  // such render. The callback itself is kept stable separately below.
  const norm = useMemo(
    () => normalizeSelectionProps<Value>(props),
    [props.multiple, props.value, props.defaultValue]
  );
  const onValuesChange = useStableOnValuesChange<Value>(props);

  const [values, setValues] = useControllableState<readonly Value[]>({
    value: norm.values,
    defaultValue: norm.defaultValues,
    onChange: onValuesChange,
  });

  const [open, setOpen] = useControllableState<boolean>({
    value: openProp,
    defaultValue: defaultOpen ?? false,
    onChange: onOpenChange,
  });

  const anchorRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const listboxRef = useRef<HTMLElement>(null);
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const listboxId = `${baseId}-listbox`;
  const [activeId, setActiveId] = useState<string | null>(null);

  const sel = useListboxSelection<Value>({
    values,
    setValues,
    multiple: norm.multiple,
    setOpen,
    isValueEqual,
    serializeValue,
    name,
    disabled,
  });

  // A reset with no defaultValue lands on [] and, in single mode, reaches the
  // consumer as onValueChange(null); it is no longer swallowed.
  useFormReset(anchorRef, () => setValues(norm.defaultValues));

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      multiple: norm.multiple,
      isSelected: sel.isSelected,
      toggle: sel.toggle,
      activeId,
      setActiveId,
      registerOption: sel.registerOption,
      selectedLabels: sel.selectedLabels,
      anchorRef,
      floatingRef,
      listboxRef,
      triggerId,
      listboxId,
      disabled,
      required,
      side,
      align,
      offset,
      loop,
      typeahead,
    }),
    [
      open,
      setOpen,
      norm.multiple,
      sel.isSelected,
      sel.toggle,
      activeId,
      sel.registerOption,
      sel.selectedLabels,
      baseId,
      disabled,
      required,
      side,
      align,
      offset,
      loop,
      typeahead,
    ]
  );

  return h(
    SelectContext.Provider,
    { value: ctx },
    h(Fragment, null, children, sel.hiddenFields)
  );
}

export { OPTION_SELECTOR } from '../listbox/selection.js';

export type SelectTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function SelectTrigger(props: SelectTriggerProps): VNode {
  const { render, children, onClick, onKeyDown, ...rest } = props;
  const ctx = useSelectContext('Trigger');

  // Focus stays on the trigger; navigation moves aria-activedescendant over the
  // options in the (separate) listbox.
  const nav = useListNavigation({
    enabled: ctx.open,
    containerRef: ctx.listboxRef,
    itemSelector: OPTION_SELECTOR,
    activeId: ctx.activeId,
    setActiveId: ctx.setActiveId,
    mode: 'activedescendant',
    loop: ctx.loop,
    typeahead: ctx.typeahead,
  });

  useHighlightSelectedOnOpen(nav, ctx.open);

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
    if (!ctx.open) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();
        ctx.setOpen(true);
      }
      return;
    }
    nav.onKeyDown(event);
    if (event.defaultPrevented) return;
    const list = nav.getItems();
    const current = list.findIndex((el) => el.id === ctx.activeId);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (current >= 0) list[current].click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      ctx.setOpen(false);
    } else if (event.key === 'Tab') {
      ctx.setOpen(false);
    }
  };

  return renderElement<{ open: boolean }>({
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
  return renderElement<{ selectedLabels: string[] }>({
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

export type SelectPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SelectPositioner(props: SelectPositionerProps) {
  const { render, children, ...rest } = props;
  const ctx = useSelectContext('Positioner');
  // Always rendered (mount: 'hidden') so options register their labels; the
  // hook drives `hidden` while not present, which composes with the top-layer
  // promotion (active only while present).
  return h(Positioner, {
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    mount: 'hidden',
    render,
    children,
    ...rest,
  });
}

export type SelectPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SelectPopup(props: SelectPopupProps): VNode {
  const { render, children, 'aria-label': ariaLabel, ...rest } = props;
  const ctx = useSelectContext('Popup');

  useDismiss({
    enabled: ctx.open,
    refs: [ctx.floatingRef, ctx.anchorRef],
    escape: true,
    outsidePress: true,
    onDismiss: () => ctx.setOpen(false),
  });

  return renderElement<{ open: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.listboxRef,
      role: 'listbox',
      id: ctx.listboxId,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabel ? undefined : ctx.triggerId,
      'aria-multiselectable': ctx.multiple ? true : undefined,
      'data-state': ctx.open ? 'open' : 'closed',
    },
    state: { open: ctx.open },
    children,
  });
}

export type SelectOptionProps<Value = string> = {
  value: Value;
  render?: RenderProp<{
    selected: boolean;
    disabled: boolean;
    highlighted: boolean;
  }>;
  disabled?: boolean;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SelectOption<Value = string>(
  props: SelectOptionProps<Value>
): VNode {
  const {
    value,
    render,
    children,
    disabled = false,
    onClick,
    onPointerEnter,
    ...rest
  } = props;
  const ctx = useSelectContext('Option');
  const id = useId();
  const selected = ctx.isSelected(value);
  const highlighted = ctx.activeId === id;

  // Register this option's label (its text content) for the trigger auto-label.
  // For string children we track the text reactively so a same-value text edit
  // re-registers; for non-string children the label is read once from the DOM
  // (changing their text without changing `value` won't update the registration).
  const stringLabel = typeof children === 'string' ? children : undefined;
  useRegisterOption(ctx.registerOption, id, value, stringLabel);

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    ctx.toggle(value);
  };
  const handlePointerEnter = (
    event: JSX.TargetedPointerEvent<HTMLDivElement>
  ) => {
    onPointerEnter?.(event);
    if (disabled) return;
    ctx.setActiveId(id);
  };

  return renderElement<{
    selected: boolean;
    disabled: boolean;
    highlighted: boolean;
  }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      id,
      role: 'option',
      'aria-selected': selected,
      'aria-disabled': disabled ? 'true' : undefined,
      'data-selected': selected ? '' : undefined,
      'data-highlighted': highlighted ? '' : undefined,
      'data-disabled': disabled ? '' : undefined,
      onClick: handleClick,
      onPointerEnter: handlePointerEnter,
    },
    state: { selected, disabled, highlighted },
    children,
  });
}

export {
  OptionGroup as SelectOptionGroup,
  OptionGroupLabel as SelectOptionGroupLabel,
  type OptionGroupProps as SelectOptionGroupProps,
  type OptionGroupLabelProps as SelectOptionGroupLabelProps,
} from '../option-group.js';

export {
  Arrow as SelectArrow,
  type ArrowProps as SelectArrowProps,
} from '../arrow.js';
