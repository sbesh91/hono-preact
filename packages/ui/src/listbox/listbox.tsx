// packages/ui/src/listbox/listbox.tsx
//
// The mid-level Listbox part set: the roving aria-activedescendant listbox
// pattern (APG combobox-with-listbox-popup) without Select's value ownership
// or Combobox's anchored-dropdown machinery. The consumer owns the option
// set (querying, filtering, ordering); the parts own ids, ARIA wiring,
// keyboard navigation, highlight state, commit, and announcements. Built for
// command palettes and custom listboxes; Select/Combobox remain the
// full-featured pickers.
import {
  h,
  type ComponentChildren,
  type CSSProperties,
  type VNode,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type TargetedKeyboardEvent,
  type TargetedMouseEvent,
  type TargetedPointerEvent,
} from 'preact';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from 'preact/hooks';
import { renderElement, type RenderProp } from '../render-element.js';
import { useListNavigation } from '../list-navigation.js';
import { OPTION_SELECTOR } from './selection.js';
import { ListboxContext, useListboxContext } from './context.js';

export interface ListboxRootProps<Value = string> {
  // Called when an option is committed (Enter on the highlighted option, or a
  // click). The Root does not hold a selected value; consumers that need one
  // keep it themselves and mark options with `selected`.
  onCommit?: (value: Value) => void;
  // Keyboard navigation, auto-highlight, and announcements are live while
  // enabled. A palette inside a dialog passes the dialog's open state.
  enabled?: boolean;
  loop?: boolean; // default true
  children?: ComponentChildren;
}

export function ListboxRoot<Value = string>(props: ListboxRootProps<Value>) {
  const { onCommit, enabled = true, loop = true, children } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [activeId, setActiveId] = useState<string | null>(null);

  // Option ids in registration order; the count drives Status/Empty and the
  // highlight-first-on-change effect below.
  const registry = useRef<string[]>([]);
  const [optionCount, setOptionCount] = useState(0);
  const registerOption = useCallback((id: string) => {
    registry.current = [...registry.current, id];
    setOptionCount(registry.current.length);
    return () => {
      registry.current = registry.current.filter((e) => e !== id);
      setOptionCount(registry.current.length);
    };
  }, []);

  // Highlight the first enabled option whenever the option set changes while
  // live (typing narrows the consumer-rendered set, opening mounts it), so
  // Enter always commits the top result.
  useLayoutEffect(() => {
    if (!enabled) return;
    const first = listRef.current?.querySelector<HTMLElement>(OPTION_SELECTOR);
    setActiveId(first?.id ?? null);
  }, [enabled, optionCount]);

  const commit = useCallback(
    // The module-level context erases the per-instance generic to unknown;
    // the Root owns the generic, so re-apply it at this one confined seam.
    (value: unknown) => onCommit?.(value as Value),
    [onCommit]
  );

  const ctx = useMemo(
    () => ({
      enabled,
      activeId,
      setActiveId,
      commit,
      registerOption,
      optionCount,
      inputRef,
      listRef,
      listId,
      loop,
    }),
    [enabled, activeId, commit, registerOption, optionCount, listId, loop]
  );

  return h(ListboxContext.Provider, { value: ctx }, children);
}

export type ListboxInputProps = {
  render?: RenderProp<{ enabled: boolean }>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'render'>;

// The text field driving the listbox (APG combobox pattern with
// aria-activedescendant): focus stays here while Arrow keys move the
// highlight, Enter commits it. Typeahead and Home/End stay native so typing
// and caret movement are never stolen from the field.
export function ListboxInput(props: ListboxInputProps): VNode {
  const { render, onKeyDown, ...rest } = props;
  const ctx = useListboxContext('Input');

  const nav = useListNavigation({
    enabled: ctx.enabled,
    containerRef: ctx.listRef,
    itemSelector: OPTION_SELECTOR,
    activeId: ctx.activeId,
    setActiveId: ctx.setActiveId,
    mode: 'activedescendant',
    loop: ctx.loop,
    typeahead: false,
    homeEnd: false,
  });

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !ctx.enabled) return;
    nav.onKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter') {
      const list = nav.getItems();
      const current = list.find((el) => el.id === ctx.activeId);
      if (current) {
        event.preventDefault();
        current.click();
      }
    }
  };

  return renderElement<{ enabled: boolean }>({
    render,
    defaultTag: 'input',
    props: {
      ...rest,
      ref: ctx.inputRef,
      type: 'text',
      role: 'combobox',
      autoComplete: 'off',
      'aria-expanded': ctx.enabled,
      'aria-controls': ctx.listId,
      'aria-activedescendant': ctx.enabled
        ? (ctx.activeId ?? undefined)
        : undefined,
      onKeyDown: handleKeyDown,
    },
    state: { enabled: ctx.enabled },
  });
}

export type ListboxListProps = {
  render?: RenderProp;
  'aria-label'?: string;
  children?: ComponentChildren;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

// The option container (`role="listbox"`). Rendered in place: a palette's
// results list is static content inside its dialog, not a floating popup.
export function ListboxList(props: ListboxListProps): VNode {
  const { render, children, ...rest } = props;
  const ctx = useListboxContext('List');
  return renderElement({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: ctx.listRef,
      id: ctx.listId,
      role: 'listbox',
      'data-empty': ctx.optionCount === 0 ? '' : undefined,
    },
    children,
  });
}

export type ListboxOptionProps<Value = string> = {
  value: Value;
  // aria-selected. When the listbox tracks a real selection, pass it; when it
  // only has a highlight (a command palette), it defaults to the highlight,
  // which is what screen readers announce as the pointed-at result.
  selected?: boolean;
  disabled?: boolean;
  render?: RenderProp<{
    selected: boolean;
    disabled: boolean;
    highlighted: boolean;
  }>;
  children?: ComponentChildren;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

export function ListboxOption<Value = string>(
  props: ListboxOptionProps<Value>
): VNode {
  const {
    value,
    selected: selectedProp,
    disabled = false,
    render,
    children,
    onClick,
    onPointerEnter,
    ...rest
  } = props;
  const ctx = useListboxContext('Option');
  const id = useId();
  const highlighted = ctx.activeId === id;
  const selected = selectedProp ?? highlighted;

  useLayoutEffect(() => {
    return ctx.registerOption(id);
  }, [ctx.registerOption, id]);

  const handleClick = (event: TargetedMouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (disabled) return;
    ctx.commit(value);
  };
  const handlePointerEnter = (event: TargetedPointerEvent<HTMLDivElement>) => {
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

const VISUALLY_HIDDEN: CSSProperties = {
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

export type ListboxStatusProps = {
  render?: RenderProp<{ count: number; enabled: boolean }>;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'render'>;

// Polite result-count announcements. Empty while not enabled so becoming
// enabled is a real text change ('' -> 'N results available') that screen
// readers announce.
export function ListboxStatus(props: ListboxStatusProps): VNode {
  const { render, style, ...rest } = props;
  const ctx = useListboxContext('Status');
  const count = ctx.optionCount;
  const message = !ctx.enabled
    ? ''
    : count === 0
      ? 'No results'
      : `${count} result${count === 1 ? '' : 's'} available`;

  return renderElement<{ count: number; enabled: boolean }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      style: { ...VISUALLY_HIDDEN, ...(style as CSSProperties) },
    },
    state: { count, enabled: ctx.enabled },
    children: render ? undefined : message,
  });
}

export type ListboxEmptyProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

export function ListboxEmpty(props: ListboxEmptyProps): VNode | null {
  const { render, children, ...rest } = props;
  const ctx = useListboxContext('Empty');
  if (!ctx.enabled || ctx.optionCount > 0) return null;
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'presentation' },
    children,
  });
}
