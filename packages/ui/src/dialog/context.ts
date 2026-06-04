import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';

export interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
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
