import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';

export interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  // When set, the Popup wraps its showModal()/close() in a View Transition and
  // hands the panel's view-transition-name to/from the Trigger so the dialog
  // morphs out of (and back into) the trigger, instead of running the
  // data-state CSS enter/exit animation through usePresence. A string is used
  // verbatim as the panel's view-transition-name (so it can be targeted in CSS,
  // e.g. to set ::view-transition-group(...) z-index); `true` auto-generates a
  // unique name.
  viewTransition: boolean | string;
  dialogRef: RefObject<HTMLDialogElement>;
  triggerId: string;
  popupId: string;
  titleId: string;
  descriptionId: string;
  hasDescription: boolean;
  // Description parts register on mount and deregister on unmount; the Popup
  // wires aria-describedby only while at least one is present.
  registerDescription: () => () => void;
}

export const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialogContext(part: string): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error(`<Dialog.${part}> must be used within <Dialog.Root>`);
  }
  return ctx;
}
