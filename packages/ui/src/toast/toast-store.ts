import type { ComponentChildren, VNode } from 'preact';

export type ToastType =
  | 'default'
  | 'success'
  | 'error'
  | 'info'
  | 'warning'
  | 'loading'
  | 'custom';

export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type DismissReason = 'user' | 'timeout';

export interface ToastAction {
  label: ComponentChildren;
  onClick: (event: MouseEvent) => void;
}

// Options accepted by the public `toast(...)` calls.
export interface ToastOptions {
  id?: string | number;
  description?: ComponentChildren;
  duration?: number; // ms; Infinity = sticky. Default DEFAULT_DURATION.
  important?: boolean; // route the announcement to the assertive region
  action?: ToastAction;
  onDismiss?: (toast: ToastRecord) => void;
  onAutoClose?: (toast: ToastRecord) => void;
}

// The stored record. `dismissed` keeps a toast in the list while its exit
// animation plays; `remove()` deletes it once the animation finishes.
export interface ToastRecord {
  id: string | number;
  type: ToastType;
  title?: ComponentChildren;
  description?: ComponentChildren;
  jsx?: (id: string | number) => VNode; // toast.custom render fn
  duration: number;
  important: boolean;
  dismissed: boolean;
  action?: ToastAction;
  onDismiss?: (toast: ToastRecord) => void;
  onAutoClose?: (toast: ToastRecord) => void;
  createdAt: number;
}

// What add() accepts: any record field plus an optional id.
export type ToastInput = Partial<Omit<ToastRecord, 'id'>> & {
  id?: string | number;
};

type Listener = (toasts: ToastRecord[]) => void;

export const DEFAULT_DURATION = 4000;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast-${counter}`;
}

export class ToastStore {
  toasts: ToastRecord[] = [];
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.toasts);
  }

  add(input: ToastInput): string | number {
    const id = input.id ?? nextId();
    if (this.toasts.some((t) => t.id === id)) {
      this.update(id, input);
      return id;
    }
    const record: ToastRecord = {
      id,
      type: input.type ?? 'default',
      title: input.title,
      description: input.description,
      jsx: input.jsx,
      duration: input.duration ?? DEFAULT_DURATION,
      important: input.important ?? false,
      dismissed: false,
      action: input.action,
      onDismiss: input.onDismiss,
      onAutoClose: input.onAutoClose,
      createdAt: Date.now(),
    };
    this.toasts = [record, ...this.toasts];
    this.emit();
    return id;
  }

  update(id: string | number, patch: Partial<ToastRecord>): void {
    let changed = false;
    this.toasts = this.toasts.map((t) => {
      if (t.id !== id) return t;
      changed = true;
      return { ...t, ...patch, id };
    });
    if (changed) this.emit();
  }

  dismiss(id?: string | number, reason: DismissReason = 'user'): void {
    for (const t of this.toasts) {
      if ((id === undefined || t.id === id) && !t.dismissed) {
        if (reason === 'timeout') t.onAutoClose?.(t);
        else t.onDismiss?.(t);
      }
    }
    this.toasts = this.toasts.map((t) =>
      id === undefined || t.id === id ? { ...t, dismissed: true } : t
    );
    this.emit();
  }

  remove(id: string | number): void {
    const next = this.toasts.filter((t) => t.id !== id);
    if (next.length !== this.toasts.length) {
      this.toasts = next;
      this.emit();
    }
  }
}

// The app-wide singleton. Toasts are client-only (fired post-hydration), so a
// module singleton is SSR-safe: the queue is empty at render time and no
// toast() call runs during SSR.
export const toastStore = new ToastStore();
