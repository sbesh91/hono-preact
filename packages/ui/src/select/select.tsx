// packages/ui/src/select/select.tsx
import {
  h,
  Fragment,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import {
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { renderElement, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import type { Side, Align } from '../use-position.js';
import { PositionerContext } from '../positioner-context.js';
import { useDismiss } from '../use-dismiss.js';
import { useListNavigation } from '../list-navigation.js';
import { useListboxSelection, OPTION_SELECTOR } from '../listbox/selection.js';
import { usePositioner } from '../use-positioner.js';
import { useFormReset } from '../use-form-reset.js';
import {
  SelectContext,
  useSelectContext,
  SelectOptionGroupContext,
} from './context.js';

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
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const listboxId = `${baseId}-listbox`;
  const [activeId, setActiveId] = useState<string | null>(null);

  const sel = useListboxSelection<Value>({
    value,
    setValue,
    multiple,
    setOpen,
    isValueEqual,
    serializeValue,
    name,
    disabled,
  });

  useFormReset(anchorRef, () => setValue(defaultValue ?? emptyDefault));

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      multiple,
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
      multiple,
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

  // On open, set the active descendant to the selected option (or the first).
  useLayoutEffect(() => {
    if (!ctx.open) return;
    const list = nav.getItems();
    if (list.length === 0) return;
    const selectedIdx = list.findIndex(
      (el) => el.getAttribute('aria-selected') === 'true'
    );
    nav.setActiveItem(selectedIdx >= 0 ? selectedIdx : 0);
  }, [ctx.open]);

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
  const { positionerProps, state, position, arrowRef } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    mount: 'hidden',
  });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  return h(
    PositionerContext.Provider,
    { value: positionerValue },
    renderElement<{ side: Side; align: Align }>({
      render,
      defaultTag: 'div',
      props: { ...rest, ...positionerProps },
      state,
      children,
    })
  );
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
  useLayoutEffect(() => {
    const label = stringLabel ?? document.getElementById(id)?.textContent ?? '';
    return ctx.registerOption(id, value, label);
  }, [id, value, stringLabel, ctx.registerOption]);

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

export type SelectOptionGroupProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

// Return type left inferred: h(Context.Provider, ...) yields a VNode with more
// specific props than VNode<{}> (matches the MenuGroup precedent).
export function SelectOptionGroup(props: SelectOptionGroupProps) {
  const { render, children, ...rest } = props;
  const labelId = useId();
  const node = renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'group', 'aria-labelledby': labelId },
    children,
  });
  return h(SelectOptionGroupContext.Provider, { value: { labelId } }, node);
}

export type SelectOptionGroupLabelProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SelectOptionGroupLabel(
  props: SelectOptionGroupLabelProps
): VNode {
  const { render, children, ...rest } = props;
  const group = useContext(SelectOptionGroupContext);
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, id: group?.labelId },
    children,
  });
}

export {
  Arrow as SelectArrow,
  type ArrowProps as SelectArrowProps,
} from '../arrow.js';
