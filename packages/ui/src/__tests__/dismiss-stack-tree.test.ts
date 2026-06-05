// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerDismissLayer, type DismissLayer } from '../dismiss-stack.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = '';
});

function makeRef(el: HTMLElement) {
  return { current: el };
}
function layer(partial: Partial<DismissLayer>): DismissLayer {
  return { refs: [], escape: true, outsidePress: true, onDismiss: vi.fn(), ...partial };
}

describe('dismiss stack tree', () => {
  it('outside press dismisses the tree root, not the topmost child', () => {
    const rootEl = document.createElement('div');
    const subEl = document.createElement('div');
    document.body.append(rootEl, subEl);
    const root = layer({ id: 'root', parentId: null, refs: [makeRef(rootEl)] });
    const sub = layer({ id: 'sub', parentId: 'root', refs: [makeRef(subEl)] });
    cleanups.push(registerDismissLayer(root), registerDismissLayer(sub));

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    expect(root.onDismiss).toHaveBeenCalledWith('outside-press');
    expect(sub.onDismiss).not.toHaveBeenCalled();
  });

  it('a press inside the parent layer of an open submenu dismisses nothing', () => {
    const rootEl = document.createElement('div');
    const subEl = document.createElement('div');
    document.body.append(rootEl, subEl);
    const root = layer({ id: 'root', parentId: null, refs: [makeRef(rootEl)] });
    const sub = layer({ id: 'sub', parentId: 'root', refs: [makeRef(subEl)] });
    cleanups.push(registerDismissLayer(root), registerDismissLayer(sub));

    rootEl.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    expect(root.onDismiss).not.toHaveBeenCalled();
    expect(sub.onDismiss).not.toHaveBeenCalled();
  });

  it('escape still routes to the innermost (topmost) layer', () => {
    const root = layer({ id: 'root', parentId: null });
    const sub = layer({ id: 'sub', parentId: 'root' });
    cleanups.push(registerDismissLayer(root), registerDismissLayer(sub));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sub.onDismiss).toHaveBeenCalledWith('escape');
    expect(root.onDismiss).not.toHaveBeenCalled();
  });
});
