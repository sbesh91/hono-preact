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
import { useRender, type RenderProp } from '../use-render.js';
import { useControllableState } from '../use-controllable-state.js';
import { usePosition } from '../use-position.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { useDismiss } from '../use-dismiss.js';
import { useListNavigation } from '../list-navigation.js';
import { useListboxSelection, OPTION_SELECTOR } from '../listbox/selection.js';
import { mergeRefs } from '../merge-refs.js';
import { usePresence } from '../use-presence.js';
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
      position,
    ]
  );

  return h(
    SelectContext.Provider,
    { value: ctx },
    h(Fragment, null, children, sel.hiddenFields)
  );
}

function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
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

export type SelectPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SelectPositioner(props: SelectPositionerProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useSelectContext('Positioner');

  const presence = usePresence(ctx.open);

  const position = usePosition({
    open: presence.isPresent,
    anchorRef: ctx.anchorRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
  });

  useLayoutEffect(() => {
    ctx.setPosition(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  // Promote to the native top layer where supported, while present (open or
  // animating out), so exit animations play in the top layer.
  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    if (!presence.isPresent || !el || !supportsPopover(el)) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      // Best-effort un-promotion: hidePopover() throws if the element already
      // left the top layer (closed by another path or disconnected). Either way
      // the goal state (not promoted) is met, so ignore the throw.
      try {
        el.hidePopover();
      } catch {
        // already hidden / disconnected
      }
      el.removeAttribute('popover');
    };
  }, [presence.isPresent]);

  // Always rendered so options register their labels; `hidden` while not
  // present makes it inert and invisible without consumer CSS, and composes
  // with the Popover-API promotion (which only runs while present).
  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: mergeRefs(ctx.floatingRef, presence.ref),
      hidden: presence.isPresent ? undefined : true,
      'data-side': position.side,
      'data-align': position.align,
      style: {
        position: 'fixed',
        inset: 'auto',
        margin: 0,
        overflow: 'visible',
        border: 0,
        padding: 0,
        background: 'transparent',
      },
    },
    state: { side: position.side, align: position.align },
    children,
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

  return useRender<{ open: boolean }>({
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

  return useRender<{
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
  const node = useRender({
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
  return useRender({
    render,
    defaultTag: 'div',
    props: { ...rest, id: group?.labelId },
    children,
  });
}

export type SelectArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function SelectArrow(props: SelectArrowProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useSelectContext('Arrow');
  const { side, arrowX, arrowY } = ctx.position;
  return useRender<{ side: Side }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.arrowRef,
      'data-side': side,
      style: {
        position: 'absolute',
        left: arrowX != null ? `${arrowX}px` : undefined,
        top: arrowY != null ? `${arrowY}px` : undefined,
      },
    },
    state: { side },
    children,
  });
}
