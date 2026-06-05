// packages/ui/src/dismiss-stack.ts
import type { RefObject } from 'preact';

export type DismissReason = 'escape' | 'outside-press';

export interface DismissLayer {
  // Elements considered "inside" this layer. A pointerdown within any of them
  // is not an outside-press. Pass the floating element and the anchor/trigger.
  refs: Array<RefObject<HTMLElement>>;
  escape: boolean;
  outsidePress: boolean;
  onDismiss: (reason: DismissReason) => void;
}

const stack: DismissLayer[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].escape) {
      stack[i].onDismiss('escape');
      return;
    }
  }
}

function onPointerDown(event: Event) {
  // event.target is EventTarget | null; narrow to Node via instanceof so
  // contains() is callable without a cast.
  const target = event.target;
  const targetNode = target instanceof Node ? target : null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    if (!layer.outsidePress) continue;
    const inside = layer.refs.some(
      (ref) =>
        ref.current != null &&
        targetNode != null &&
        ref.current.contains(targetNode)
    );
    // The first outside-press layer from the top decides: if the press landed
    // inside it, nothing dismisses; otherwise it dismisses and we stop.
    if (inside) return;
    layer.onDismiss('outside-press');
    return;
  }
}

function ensureListening() {
  if (listening) return;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  listening = true;
}

function stopListening() {
  if (!listening) return;
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('pointerdown', onPointerDown, true);
  listening = false;
}

// Push a layer onto the stack; returns an unregister function. The shared
// document listeners attach on the first layer and detach when the last leaves.
export function registerDismissLayer(layer: DismissLayer): () => void {
  stack.push(layer);
  ensureListening();
  return () => {
    const index = stack.indexOf(layer);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0) stopListening();
  };
}
