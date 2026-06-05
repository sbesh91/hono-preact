// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { usePosition } from '../use-position.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function Harness() {
  const floatingRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement>(null);
  usePosition({
    open: true,
    anchorRef,
    floatingRef,
    getAnchorRect: () => ({
      width: 0, height: 0, x: 50, y: 60, top: 60, left: 50, right: 50, bottom: 60,
    }),
    side: 'bottom',
    align: 'start',
  });
  return <div ref={floatingRef}>floating</div>;
}

describe('usePosition virtual anchor', () => {
  it('positions a floating element from getAnchorRect without an anchor element', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    render(<Harness />, host);
    await new Promise((r) => setTimeout(r, 0));
    const el = host.querySelector('div')!;
    // Virtual element path ran: position is set to fixed.
    expect(el.style.position).toBe('fixed');
    // The virtual rect (top: 60, bottom: 60) drives y. In happy-dom's 0x0
    // viewport, flip picks the top side and y = 60 - offset(8) = 52, which is
    // non-zero and derived from the virtual rect (not from an anchor element).
    const top = parseFloat(el.style.top);
    expect(top).toBeGreaterThan(0);
    // left is set to some value (shift adjusts it to the viewport edge in
    // happy-dom's 0x0 viewport, but the style is present).
    expect(el.style.left).not.toBe('');
  });
});
