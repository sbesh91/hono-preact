// packages/ui/src/combobox/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { Side, Align, PositionState } from '../use-position.js';
import type { OptionEntry } from '../listbox/selection.js';

export type AutocompleteMode = 'none' | 'list' | 'both';

// The value generic is erased to `unknown` at this module-level context. The
// public Root/Option props re-apply the generic; Root owns the comparator so
// value handling stays in one typed place (mirrors Select).
export interface ComboboxContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  multiple: boolean;
  inputValue: string; // the typed query (never the inline completion)
  setInputValue: (v: string) => void;
  autocomplete: AutocompleteMode;
  // selection
  isSelected: (optionValue: unknown) => boolean;
  selectOption: (optionValue: unknown) => void; // commit + input/open side effects
  createOption: () => void; // route to onCreate + input/open side effects
  hasOnCreate: boolean;
  registerOption: (id: string, value: unknown, label: string) => () => void;
  selectedItems: () => OptionEntry[];
  labelFor: (value: unknown) => string;
  optionCount: number;
  // navigation / active descendant
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  // refs + ids
  inputRef: RefObject<HTMLInputElement>;
  triggerRef: RefObject<HTMLElement>;
  clearRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  listboxRef: RefObject<HTMLElement>;
  arrowRef: RefObject<HTMLElement>;
  inputId: string;
  listboxId: string;
  // flags + positioning
  disabled: boolean;
  required: boolean;
  loop: boolean;
  side: Side;
  align: Align;
  offset: number;
  position: PositionState;
  setPosition: (p: PositionState) => void;
}

export const ComboboxContext = createContext<ComboboxContextValue | null>(null);

export function useComboboxContext(part: string): ComboboxContextValue {
  const ctx = useContext(ComboboxContext);
  if (!ctx) {
    throw new Error(`<Combobox.${part}> must be used within <Combobox.Root>`);
  }
  return ctx;
}

export interface ComboboxOptionGroupContextValue {
  labelId: string;
}
export const ComboboxOptionGroupContext =
  createContext<ComboboxOptionGroupContextValue | null>(null);
