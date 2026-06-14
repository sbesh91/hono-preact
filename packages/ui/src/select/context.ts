// packages/ui/src/select/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { Side, Align } from '../use-position.js';

// The value generic is erased to `unknown` at this module-level context (a
// Preact context cannot carry a per-instance generic). The public Root/Option
// props re-apply the generic; Root owns the comparator so all value handling
// stays in one typed place.
export interface SelectContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  multiple: boolean;
  isSelected: (optionValue: unknown) => boolean;
  toggle: (optionValue: unknown) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  registerOption: (id: string, value: unknown, label: string) => () => void;
  selectedLabels: () => string[];
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  listboxRef: RefObject<HTMLElement>;
  triggerId: string;
  listboxId: string;
  disabled: boolean;
  required: boolean;
  side: Side;
  align: Align;
  offset: number;
  loop: boolean;
  typeahead: boolean;
}

export const SelectContext = createContext<SelectContextValue | null>(null);

export function useSelectContext(part: string): SelectContextValue {
  const ctx = useContext(SelectContext);
  if (!ctx) {
    throw new Error(`<Select.${part}> must be used within <Select.Root>`);
  }
  return ctx;
}
