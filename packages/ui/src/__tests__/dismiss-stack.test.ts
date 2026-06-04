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
  return {
    refs: [],
    escape: true,
    outsidePress: true,
    onDismiss: vi.fn(),
    ...partial,
  };
}

describe('dismiss stack', () => {
  it('routes Escape to the topmost escape-enabled layer only', () => {
    const bottom = layer({});
    const top = layer({});
    cleanups.push(registerDismissLayer(bottom), registerDismissLayer(top));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(top.onDismiss).toHaveBeenCalledWith('escape');
    expect(bottom.onDismiss).not.toHaveBeenCalled();
  });

  it('skips layers that opted out of escape', () => {
    const noEscape = layer({ escape: false });
    cleanups.push(registerDismissLayer(noEscape));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(noEscape.onDismiss).not.toHaveBeenCalled();
  });

  it('does not dismiss when the press is inside the layer refs', () => {
    const inside = document.createElement('div');
    document.body.append(inside);
    const l = layer({ refs: [makeRef(inside)] });
    cleanups.push(registerDismissLayer(l));

    inside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(l.onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses the topmost outside-press layer on an outside press', () => {
    const inside = document.createElement('div');
    const outside = document.createElement('div');
    document.body.append(inside, outside);
    const l = layer({ refs: [makeRef(inside)] });
    cleanups.push(registerDismissLayer(l));

    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(l.onDismiss).toHaveBeenCalledWith('outside-press');
  });

  it('detaches listeners when the stack empties', () => {
    const l = layer({});
    const unregister = registerDismissLayer(l);
    unregister();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(l.onDismiss).not.toHaveBeenCalled();
  });
});
