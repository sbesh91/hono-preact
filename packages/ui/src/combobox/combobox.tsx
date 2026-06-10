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
import type { Side, Align, PositionState } from '../use-position.js';
import { usePositioner } from '../use-positioner.js';
import { useDismiss } from '../use-dismiss.js';
import { useRender, type RenderProp } from '../use-render.js';
import { useListboxSelection, OPTION_SELECTOR } from '../listbox/selection.js';
import type { OptionEntry } from '../listbox/selection.js';
import { useListNavigation } from '../list-navigation.js';
import {
  ComboboxContext,
  ComboboxOptionGroupContext,
  useComboboxContext,
  type AutocompleteMode,
} from './context.js';
import { computeInlineCompletion, isForwardEdit } from './autocomplete.js';

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
  openOnFocus?: boolean; // open the popup when the input gains focus (default true)
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
    openOnFocus = true,
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
  const anchorRef = useRef<HTMLElement>(null);
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

  const clear = useCallback(() => {
    setValue((multiple ? [] : undefined) as Value | Value[]);
    setInputValue('');
    inputRef.current?.focus();
  }, [setValue, multiple, setInputValue]);

  // Revert the input text to the committed value when dismissing without a fresh
  // pick (single -> the selected option's label; multiple -> '' since the chips
  // carry the value). Keeps the input from showing dangling, unselected text.
  const revertInput = useCallback(() => {
    const items = sel.selectedItems();
    setInputValue(multiple ? '' : (items[0]?.label ?? ''));
  }, [sel.selectedItems, multiple, setInputValue]);

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
      clear,
      revertInput,
      activeId,
      setActiveId,
      inputRef,
      anchorRef,
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
      openOnFocus,
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
      clear,
      revertInput,
      activeId,
      baseId,
      disabled,
      required,
      loop,
      openOnFocus,
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

export type ComboboxPositionerProps = {
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ComboboxPositioner(props: ComboboxPositionerProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useComboboxContext('Positioner');
  // Anchor to the <Combobox.Anchor> field if one is rendered, else the input.
  // Both refs are stable, so the callback is stable (no autoUpdate churn).
  const getAnchorRect = useCallback(
    () =>
      (
        ctx.anchorRef.current ?? ctx.inputRef.current
      )?.getBoundingClientRect() ?? null,
    [ctx.anchorRef, ctx.inputRef]
  );
  const { positionerProps, state } = usePositioner({
    open: ctx.open,
    anchorRef: ctx.inputRef,
    floatingRef: ctx.floatingRef,
    arrowRef: ctx.arrowRef,
    side: ctx.side,
    align: ctx.align,
    offset: ctx.offset,
    getAnchorRect,
    setPosition: ctx.setPosition,
    mount: 'hidden',
  });
  return useRender<{ side: Side; align: Align }>({
    render,
    defaultTag: 'div',
    props: { ...rest, ...positionerProps },
    state,
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
    refs: [
      ctx.floatingRef,
      ctx.anchorRef,
      ctx.inputRef,
      ctx.triggerRef,
      ctx.clearRef,
    ],
    escape: false, // Escape is handled by the Input (close then revert)
    outsidePress: true,
    onDismiss: () => {
      ctx.revertInput(); // restore the committed label; drop any dangling query
      ctx.setOpen(false);
    },
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

export type ComboboxAnchorProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLElement>, 'children'>;

// Optional wrapper that becomes the positioning anchor for the popup. Wrap the
// Input (and any chips / Trigger / Clear) in it so the popup aligns to the whole
// field instead of the bare input. It writes the shared anchorRef; because it
// wraps the Input, its parent ref fires after the Input's, so it wins. Also a
// dismiss-safe region (clicking the field's padding or chips will not close).
export function ComboboxAnchor(props: ComboboxAnchorProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useComboboxContext('Anchor');
  return useRender({
    render,
    defaultTag: 'div',
    props: { ...rest, ref: ctx.anchorRef },
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

  // Register this option's label for the value->label cache and chips. For
  // string children we track the text reactively so a same-value text edit
  // re-registers; for non-string children the label is read once from the DOM
  // (changing their text without changing `value` won't update the registration).
  const stringLabel = typeof children === 'string' ? children : undefined;
  useLayoutEffect(() => {
    const label = stringLabel ?? document.getElementById(id)?.textContent ?? '';
    return ctx.registerOption(id, value, label);
  }, [id, value, stringLabel, ctx.registerOption]);

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

const VISUALLY_HIDDEN: JSX.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export type ComboboxStatusProps = {
  render?: RenderProp<{ count: number; open: boolean }>;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'render'>;

export function ComboboxStatus(props: ComboboxStatusProps): VNode {
  const { render, style, ...rest } = props;
  const ctx = useComboboxContext('Status');
  const count = ctx.optionCount;
  const message = !ctx.open
    ? ''
    : count === 0
      ? 'No results'
      : `${count} result${count === 1 ? '' : 's'} available`;

  return useRender<{ count: number; open: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      style: { ...VISUALLY_HIDDEN, ...(style as JSX.CSSProperties) },
    },
    state: { count, open: ctx.open },
    children: render ? undefined : message,
  });
}

export type ComboboxInputProps = {
  render?: RenderProp<{ open: boolean }>;
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'render'>;

export function ComboboxInput(props: ComboboxInputProps): VNode {
  const { render, onInput, onKeyDown, onFocus, onClick, ...rest } = props;
  const ctx = useComboboxContext('Input');

  const nav = useListNavigation({
    enabled: ctx.open,
    containerRef: ctx.listboxRef,
    itemSelector: OPTION_SELECTOR,
    activeId: ctx.activeId,
    setActiveId: ctx.setActiveId,
    mode: 'activedescendant',
    loop: ctx.loop,
    typeahead: false,
    homeEnd: false,
  });

  // Inline completion (mode 'both'): the DOM input is controlled by `display`,
  // which may carry the first option's completed label with the appended suffix
  // text-selected. The public `inputValue` always stays the typed query.
  const composingRef = useRef(false);
  const prevQueryRef = useRef(ctx.inputValue);
  const attemptRef = useRef(false);
  const hadSelRef = useRef(false);
  const [display, setDisplay] = useState(ctx.inputValue);
  const [selRange, setSelRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const inline = ctx.autocomplete === 'both';

  // Keep `display` in sync with the query when there is no active completion, and
  // drop a completion that the query has outgrown. A completion is "stale" when
  // the query changed from something other than the user typing over it (a
  // commit, a clear, or a controlled `inputValue` update): the typed-query ref no
  // longer matches `inputValue`, so the displayed completion must be dropped and
  // the display resynced to the query.
  useLayoutEffect(() => {
    const stale = selRange != null && ctx.inputValue !== prevQueryRef.current;
    if (selRange == null || stale) {
      setSelRange(null);
      setDisplay(ctx.inputValue);
      prevQueryRef.current = ctx.inputValue;
    }
  }, [ctx.inputValue]);

  // Compute the completion after the consumer re-renders the filtered list.
  useLayoutEffect(() => {
    if (!inline || !attemptRef.current || !ctx.open) return;
    attemptRef.current = false;
    const list = nav.getItems();
    const firstLabel = list.length > 0 ? (list[0].textContent ?? '') : null;
    const c = computeInlineCompletion(ctx.inputValue, firstLabel);
    if (c) {
      setDisplay(c.text);
      setSelRange({ start: c.selStart, end: c.selEnd });
    } else {
      setDisplay(ctx.inputValue);
      setSelRange(null);
    }
  }, [ctx.inputValue, ctx.optionCount, ctx.open, inline]);

  // Re-apply the selection on every render while a completion is active (Preact
  // rewrites `.value` each render, clearing the selection). When a completion
  // clears (commit, caret keys, Escape, controlled change), collapse the lingering
  // selection to the caret end exactly once. Doing the collapse here, keyed off
  // the selRange transition rather than at each clearing site, keeps it robust to
  // the ordering of the other layout effects.
  useLayoutEffect(() => {
    const el = ctx.inputRef.current;
    if (!el) return;
    if (selRange) {
      el.setSelectionRange(selRange.start, selRange.end);
      hadSelRef.current = true;
    } else if (hadSelRef.current) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
      hadSelRef.current = false;
    }
  });

  // On open, highlight the selected option (single) or the first option.
  useLayoutEffect(() => {
    if (!ctx.open) return;
    const list = nav.getItems();
    if (list.length === 0) return;
    const selectedIdx = list.findIndex(
      (el) => el.getAttribute('aria-selected') === 'true'
    );
    nav.setActiveItem(selectedIdx >= 0 ? selectedIdx : 0);
  }, [ctx.open]);

  // Auto-highlight the first option whenever the filtered set changes while
  // open, in list/both modes (so Enter commits the top match).
  useLayoutEffect(() => {
    if (!ctx.open || ctx.autocomplete === 'none') return;
    const list = nav.getItems();
    if (list.length > 0) nav.setActiveItem(0);
    else ctx.setActiveId(null);
  }, [ctx.inputValue, ctx.optionCount, ctx.open, ctx.autocomplete]);

  const runInput = (raw: string) => {
    const forward = isForwardEdit(prevQueryRef.current, raw);
    prevQueryRef.current = raw;
    setSelRange(null);
    setDisplay(raw);
    ctx.setInputValue(raw);
    if (!ctx.open) ctx.setOpen(true);
    if (inline && forward) attemptRef.current = true;
  };

  const handleInput = (event: JSX.TargetedInputEvent<HTMLInputElement>) => {
    onInput?.(event);
    const raw = event.currentTarget.value;
    if (composingRef.current) {
      setDisplay(raw); // mirror the composing text; do not filter/complete yet
      return;
    }
    runInput(raw);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };
  const handleCompositionEnd = (
    event: JSX.TargetedCompositionEvent<HTMLInputElement>
  ) => {
    composingRef.current = false;
    runInput(event.currentTarget.value);
  };

  const commitActive = () => {
    const list = nav.getItems();
    const current = list.findIndex((el) => el.id === ctx.activeId);
    if (current >= 0) list[current].click();
  };

  const handleKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLInputElement>
  ) => {
    onKeyDown?.(event);
    if (ctx.disabled || event.defaultPrevented) return;

    // multiple: Backspace on an empty input removes the last token
    if (
      ctx.multiple &&
      event.key === 'Backspace' &&
      ctx.inputValue === '' &&
      event.currentTarget.value === ''
    ) {
      const items = ctx.selectedItems();
      if (items.length > 0) {
        event.preventDefault();
        ctx.selectOption(items[items.length - 1].value);
        return;
      }
    }

    if (!ctx.open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        ctx.setOpen(true);
      }
      return;
    }

    // Open: Alt+ArrowUp closes; let the nav hook handle Arrow up/down.
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      ctx.setOpen(false);
      return;
    }
    nav.onKeyDown(event);
    if (event.defaultPrevented) return;

    if (event.key === 'Tab' && inline && selRange) {
      // accept the inline completion by committing the active (first) option
      event.preventDefault();
      commitActive();
      return;
    }
    if (selRange && (event.key === 'ArrowLeft' || event.key === 'Home')) {
      // cancel completion, keep the typed query
      setSelRange(null);
      setDisplay(ctx.inputValue);
      return;
    }
    if (selRange && (event.key === 'ArrowRight' || event.key === 'End')) {
      // accept the completed text (not the option) and refilter to it
      setSelRange(null);
      ctx.setInputValue(display);
      return;
    }

    if (event.key === 'Enter') {
      // Only consume Enter when there is an option to commit; otherwise let
      // native form submission proceed (e.g. autocomplete="none" with no
      // navigation, where activeId is null).
      if (ctx.activeId != null) {
        event.preventDefault();
        commitActive();
      }
    } else if (event.key === 'Escape') {
      // First Escape: close but keep the typed query (the deliberate two-stage
      // exception, so you can reopen and keep editing).
      event.preventDefault();
      setSelRange(null);
      setDisplay(ctx.inputValue);
      ctx.setOpen(false);
    } else if (event.key === 'Tab') {
      // Leaving the field without a fresh pick: revert to the committed value.
      ctx.revertInput();
      ctx.setOpen(false);
    }
  };

  // Second Escape (already closed) reverts the input to the committed value.
  const handleClosedEscape = (
    event: JSX.TargetedKeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key !== 'Escape' || ctx.open) return;
    event.preventDefault();
    ctx.revertInput();
  };

  // openOnFocus: open the popup when the input gains focus, and when it is
  // clicked while focused-but-closed (focus does not re-fire on a repeat click).
  const openIfFocusOpen = () => {
    if (ctx.openOnFocus && !ctx.disabled && !ctx.open) ctx.setOpen(true);
  };
  const handleFocus = (event: JSX.TargetedFocusEvent<HTMLInputElement>) => {
    onFocus?.(event);
    // Select the text so the first keystroke starts a fresh search (keyboard
    // focus; a mouse click then places the caret, which is the expected
    // behavior). Reverts on dismiss if nothing new is picked.
    event.currentTarget.select();
    openIfFocusOpen();
  };
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLInputElement>) => {
    onClick?.(event);
    openIfFocusOpen();
  };

  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'input',
    props: {
      ...rest,
      ref: ctx.inputRef,
      type: 'text',
      role: 'combobox',
      autoComplete: 'off',
      'aria-autocomplete': ctx.autocomplete,
      'aria-expanded': ctx.open,
      'aria-controls': ctx.listboxId,
      'aria-activedescendant': ctx.open
        ? (ctx.activeId ?? undefined)
        : undefined,
      'aria-required': ctx.required ? true : undefined,
      id: ctx.inputId,
      disabled: ctx.disabled,
      value: display,
      'data-state': ctx.open ? 'open' : 'closed',
      onInput: handleInput,
      onFocus: handleFocus,
      onClick: handleClick,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
      onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
        handleKeyDown(event);
        handleClosedEscape(event);
      },
    },
    state: { open: ctx.open },
  });
}

export type ComboboxTriggerProps = {
  render?: RenderProp<{ open: boolean }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function ComboboxTrigger(props: ComboboxTriggerProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = useComboboxContext('Trigger');
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (ctx.disabled) return;
    ctx.setOpen(!ctx.open);
    ctx.inputRef.current?.focus();
  };
  return useRender<{ open: boolean }>({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.triggerRef,
      type: 'button',
      tabIndex: -1,
      'aria-controls': ctx.listboxId,
      'aria-expanded': ctx.open,
      'aria-label': rest['aria-label'] ?? 'Open',
      disabled: ctx.disabled,
      'data-state': ctx.open ? 'open' : 'closed',
      onClick: handleClick,
    },
    state: { open: ctx.open },
    children,
  });
}

export type ComboboxClearProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'children'>;

export function ComboboxClear(props: ComboboxClearProps): VNode {
  const { render, children, onClick, ...rest } = props;
  const ctx = useComboboxContext('Clear');
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (ctx.disabled) return;
    ctx.clear();
  };
  return useRender({
    render,
    defaultTag: 'button',
    props: {
      ...rest,
      ref: ctx.clearRef,
      type: 'button',
      'aria-label': rest['aria-label'] ?? 'Clear',
      disabled: ctx.disabled,
      onClick: handleClick,
    },
    children,
  });
}

export type ComboboxEmptyProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function ComboboxEmpty(props: ComboboxEmptyProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useComboboxContext('Empty');
  if (!ctx.open || ctx.optionCount > 0) return null;
  return useRender({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'presentation' },
    children,
  });
}

export interface ComboboxValueState {
  selectedItems: OptionEntry[];
  remove: (value: unknown) => void;
}

export type ComboboxValueProps = {
  children: (state: ComboboxValueState) => ComponentChildren;
};

export function ComboboxValue(props: ComboboxValueProps): VNode {
  const ctx = useComboboxContext('Value');
  const selectedItems = ctx.selectedItems();
  const remove = (value: unknown) => ctx.selectOption(value); // toggle off
  return h(Fragment, null, props.children({ selectedItems, remove }));
}
