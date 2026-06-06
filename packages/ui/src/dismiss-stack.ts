// packages/ui/src/dismiss-stack.ts
import type { RefObject } from 'preact';

export type DismissReason = 'escape' | 'outside-press';

export interface DismissLayer {
  // Optional tree identity. A layer with a parentId coordinates with its
  // ancestors/descendants for outside-press (whole-tree dismissal). Layers with
  // no id are single-node trees (Popover, Tooltip), preserving prior behavior.
  id?: string;
  parentId?: string | null;
  // Elements considered "inside" this layer. A pointerdown within any of them
  // is not an outside-press. Pass the floating element and the anchor/trigger.
  refs: Array<RefObject<HTMLElement>>;
  escape: boolean;
  outsidePress: boolean;
  onDismiss: (reason: DismissReason) => void;
}

const stack: DismissLayer[] = [];
let listening = false;
let autoId = 0;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].escape) {
      stack[i].onDismiss('escape');
      return;
    }
  }
}

// Walk parentId pointers to the root layer of the tree the given layer is in.
function rootOf(layer: DismissLayer): DismissLayer {
  let current = layer;
  while (current.parentId != null) {
    const parent = stack.find((l) => l.id === current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function pressInside(layer: DismissLayer, target: Node | null): boolean {
  return layer.refs.some(
    (ref) =>
      ref.current != null && target != null && ref.current.contains(target)
  );
}

function onPointerDown(event: Event) {
  const target = event.target;
  const targetNode = target instanceof Node ? target : null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    if (!layer.outsidePress) continue;

    // The press is "inside" if it landed within any layer of this layer's tree
    // (the layer, its ancestors, or its descendants). The tree is identified by
    // a shared root.
    const root = rootOf(layer);
    const tree = stack.filter((l) => rootOf(l) === root);
    const inside = tree.some((l) => pressInside(l, targetNode));
    if (inside) return;

    // Outside the whole tree: dismiss the root (which unmounts the subtree).
    root.onDismiss('outside-press');
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

// Push a layer onto the stack; returns an unregister function. A layer with no
// id is assigned a unique one so rootOf treats it as its own single-node tree.
export function registerDismissLayer(layer: DismissLayer): () => void {
  if (layer.id == null) layer.id = `dismiss-${autoId++}`;
  if (layer.parentId === undefined) layer.parentId = null;
  stack.push(layer);
  ensureListening();
  return () => {
    const index = stack.indexOf(layer);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0) stopListening();
  };
}
