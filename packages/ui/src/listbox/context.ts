// packages/ui/src/listbox/context.ts
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';

// The value generic is erased to `unknown` at this module-level context. The
// public Root/Option props re-apply the generic; the Root owns the commit
// callback so value handling stays in one typed place (mirrors Select).
export interface ListboxContextValue {
  // Whether keyboard navigation and announcements are live. A palette inside
  // a Dialog passes its open state here.
  enabled: boolean;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  commit: (value: unknown) => void;
  // Options register for the count that drives Status/Empty and the
  // auto-highlight-on-change behavior.
  registerOption: (id: string) => () => void;
  optionCount: number;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLElement | null>;
  listId: string;
  loop: boolean;
}

export const ListboxContext = createContext<ListboxContextValue | null>(null);

export function useListboxContext(part: string): ListboxContextValue {
  const ctx = useContext(ListboxContext);
  if (!ctx) {
    throw new Error(`<Listbox.${part}> must be used within <Listbox.Root>`);
  }
  return ctx;
}
