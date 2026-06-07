// packages/ui/src/combobox/combobox.tsx
import {
  h,
  Fragment,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import {
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useControllableState } from '../use-controllable-state.js';
import { usePosition } from '../use-position.js';
import type { Side, Align, PositionState } from '../use-position.js';
import { useDismiss } from '../use-dismiss.js';
import { useRender, type RenderProp } from '../use-render.js';
import { useListboxSelection } from '../listbox/selection.js';
import {
  ComboboxContext,
  ComboboxOptionGroupContext,
  useComboboxContext,
  type AutocompleteMode,
} from './context.js';

export interface ComboboxRootProps<Value = string> {
  value?: Value | Value[];
  defaultValue?: Value | Value[];
  onValueChange?: (value: Value | Value[]) => void;
  multiple?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  inputValue?: string;
  defaultInputValue?: string;
  onInputChange?: (value: string) => void;
  autocomplete?: AutocompleteMode; // default 'list'
  onCreate?: (inputValue: string) => void;
  itemToString?: (value: Value) => string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  isValueEqual?: (a: Value, b: Value) => boolean;
  serializeValue?: (value: Value) => string;
  side?: Side; // default 'bottom'
  align?: Align; // default 'start'
  offset?: number; // default 8
  loop?: boolean; // default true
  children?: ComponentChildren;
}

export function ComboboxRoot<Value = string>(props: ComboboxRootProps<Value>) {
  const {
    value: valueProp,
    defaultValue,
    onValueChange,
    multiple = false,
    open: openProp,
    defaultOpen,
    onOpenChange,
    inputValue: inputValueProp,
    defaultInputValue,
    onInputChange,
    autocomplete = 'list',
    onCreate,
    itemToString,
    name,
    disabled = false,
    required = false,
    isValueEqual,
    serializeValue,
    side = 'bottom',
    align = 'start',
    offset = 8,
    loop = true,
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
  const [inputValue, setInputValue] = useControllableState<string>({
    value: inputValueProp,
    defaultValue: defaultInputValue ?? '',
    onChange: onInputChange,
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const clearRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<HTMLElement>(null);
  const listboxRef = useRef<HTMLElement>(null);
  const arrowRef = useRef<HTMLElement>(null);
  const baseId = useId();
  const inputId = `${baseId}-input`;
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
    itemToString,
    name,
    disabled,
  });

  // Combobox-specific commit: core toggle (updates value, closes if single)
  // plus the input-text side effects (single resets to the label, multi clears
  // for the next token).
  const selectOption = useCallback(
    (optionValue: unknown) => {
      sel.toggle(optionValue);
      setInputValue(multiple ? '' : sel.labelFor(optionValue));
    },
    [sel.toggle, sel.labelFor, multiple, setInputValue]
  );

  // Creatable: route to onCreate (consumer persists + selects). Mirror the
  // input/open side effects without owning value. The created label is assumed
  // to be the typed text.
  const createOption = useCallback(() => {
    onCreate?.(inputValue);
    if (multiple) {
      setInputValue('');
    } else {
      setInputValue(inputValue);
      setOpen(false);
    }
  }, [onCreate, inputValue, multiple, setInputValue, setOpen]);

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      multiple,
      inputValue,
      setInputValue,
      autocomplete,
      isSelected: sel.isSelected,
      selectOption,
      createOption,
      hasOnCreate: onCreate != null,
      registerOption: sel.registerOption,
      selectedItems: sel.selectedItems,
      labelFor: sel.labelFor,
      optionCount: sel.optionCount,
      activeId,
      setActiveId,
      inputRef,
      triggerRef,
      clearRef,
      floatingRef,
      listboxRef,
      arrowRef,
      inputId,
      listboxId,
      disabled,
      required,
      loop,
      side,
      align,
      offset,
      position,
      setPosition,
    }),
    [
      open,
      setOpen,
      multiple,
      inputValue,
      setInputValue,
      autocomplete,
      sel.isSelected,
      selectOption,
      createOption,
      onCreate,
      sel.registerOption,
      sel.selectedItems,
      sel.labelFor,
      sel.optionCount,
      activeId,
      baseId,
      disabled,
      required,
      loop,
      side,
      align,
      offset,
      position,
    ]
  );

  return h(
    ComboboxContext.Provider,
    { value: ctx },
    h(Fragment, null, children, sel.hiddenFields)
  );
}

// ---------------------------------------------------------------------------
// Task 6: Positioner, Popup (listbox), Arrow
// ---------------------------------------------------------------------------

function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === 'function';
}

export type ComboboxPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ComboboxPositioner(props: ComboboxPositionerProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useComboboxContext('Positioner');

  const position = usePosition({
    open: ctx.open,
    anchorRef: ctx.inputRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
  });

  useLayoutEffect(() => {
    ctx.setPosition(position);
  }, [position.side, position.align, position.arrowX, position.arrowY]);

  useLayoutEffect(() => {
    const el = ctx.floatingRef.current;
    if (!ctx.open || !el || !supportsPopover(el)) return;
    el.setAttribute('popover', 'manual');
    el.showPopover();
    return () => {
      el.hidePopover();
      el.removeAttribute('popover');
    };
  }, [ctx.open]);

  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.floatingRef,
      hidden: ctx.open ? undefined : true,
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

export type ComboboxPopupProps = {
  render?: RenderProp<{ open: boolean }>;
  'aria-label'?: string;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ComboboxPopup(props: ComboboxPopupProps): VNode {
  const { render, children, 'aria-label': ariaLabel, ...rest } = props;
  const ctx = useComboboxContext('Popup');

  useDismiss({
    enabled: ctx.open,
    refs: [ctx.floatingRef, ctx.inputRef, ctx.triggerRef, ctx.clearRef],
    escape: false, // Escape is handled by the Input (close then revert)
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
      'aria-labelledby': ariaLabel ? undefined : ctx.inputId,
      'aria-multiselectable': ctx.multiple ? true : undefined,
      'data-state': ctx.open ? 'open' : 'closed',
      'data-empty': ctx.optionCount === 0 ? '' : undefined,
    },
    state: { open: ctx.open },
    children,
  });
}

export type ComboboxArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ComboboxArrow(props: ComboboxArrowProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useComboboxContext('Arrow');
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

// ---------------------------------------------------------------------------
// Task 7: Option, OptionGroup, OptionGroupLabel (with `create` routing)
// ---------------------------------------------------------------------------

export type ComboboxOptionProps<Value = string> = {
  value: Value;
  create?: boolean; // routes selection to onCreate instead of committing value
  render?: RenderProp<{
    selected: boolean;
    disabled: boolean;
    highlighted: boolean;
  }>;
  disabled?: boolean;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ComboboxOption<Value = string>(
  props: ComboboxOptionProps<Value>
): VNode {
  const {
    value,
    create = false,
    render,
    children,
    disabled = false,
    onClick,
    onPointerEnter,
    ...rest
  } = props;
  const ctx = useComboboxContext('Option');
  const id = useId();
  const selected = ctx.isSelected(value);
  const highlighted = ctx.activeId === id;

  useLayoutEffect(() => {
    const label =
      typeof children === 'string'
        ? children
        : (document.getElementById(id)?.textContent ?? '');
    return ctx.registerOption(id, value, label);
  }, [id, value, ctx.registerOption]);

  const commit = () => {
    if (create) {
      if (ctx.hasOnCreate) ctx.createOption();
      else ctx.selectOption(value);
    } else {
      ctx.selectOption(value);
    }
  };

  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    commit();
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

export type ComboboxOptionGroupProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ComboboxOptionGroup(props: ComboboxOptionGroupProps) {
  const { render, children, ...rest } = props;
  const labelId = useId();
  const node = useRender({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'group', 'aria-labelledby': labelId },
    children,
  });
  return h(ComboboxOptionGroupContext.Provider, { value: { labelId } }, node);
}

export type ComboboxOptionGroupLabelProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ComboboxOptionGroupLabel(
  props: ComboboxOptionGroupLabelProps
): VNode {
  const { render, children, ...rest } = props;
  const group = useContext(ComboboxOptionGroupContext);
  return useRender({
    render,
    defaultTag: 'div',
    props: { ...rest, id: group?.labelId },
    children,
  });
}
