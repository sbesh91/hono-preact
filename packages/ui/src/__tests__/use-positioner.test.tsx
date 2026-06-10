// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { usePositioner } from '../use-positioner.js';
import type { PositionState, ClientRectGetter } from '../use-position.js';

afterEach(cleanup);

function Harness(props: {
  open: boolean;
  mount: 'unmount' | 'hidden';
  getAnchorRect?: ClientRectGetter;
  onPosition?: (p: PositionState) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const { isPresent, positionerProps } = usePositioner({
    open: props.open,
    anchorRef,
    floatingRef,
    arrowRef,
    side: 'bottom',
    align: 'start',
    offset: 8,
    getAnchorRect: props.getAnchorRect,
    setPosition: (p) => props.onPosition?.(p),
    mount: props.mount,
  });
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <span data-testid="present">{String(isPresent)}</span>
      {props.mount === 'unmount' && !isPresent ? null : (
        <div data-testid="floating" {...positionerProps} />
      )}
    </div>
  );
}

describe('usePositioner', () => {
  it('unmount mode: not present when closed, present when open', () => {
    const closed = render(<Harness open={false} mount="unmount" />);
    expect(closed.getByTestId('present').textContent).toBe('false');
    expect(closed.queryByTestId('floating')).toBeNull();
    cleanup();
    const open = render(<Harness open mount="unmount" />);
    expect(open.getByTestId('present').textContent).toBe('true');
    expect(open.queryByTestId('floating')).not.toBeNull();
    expect(open.getByTestId('floating').hasAttribute('hidden')).toBe(false);
  });

  it('hidden mode: stays mounted; hidden toggles with open', () => {
    const closed = render(<Harness open={false} mount="hidden" />);
    // Always rendered, but hidden while closed.
    expect(closed.queryByTestId('floating')).not.toBeNull();
    expect(closed.getByTestId('floating').hasAttribute('hidden')).toBe(true);
    cleanup();
    const open = render(<Harness open mount="hidden" />);
    expect(open.getByTestId('floating').hasAttribute('hidden')).toBe(false);
  });

  it('emits the neutralize style and data-side/data-align', () => {
    const { getByTestId } = render(<Harness open mount="unmount" />);
    const el = getByTestId('floating');
    expect(el.style.position).toBe('fixed');
    expect(el.getAttribute('data-side')).toBe('bottom');
    expect(el.getAttribute('data-align')).toBe('start');
  });

  it('publishes the resolved position via setPosition', () => {
    const seen: PositionState[] = [];
    render(<Harness open mount="unmount" onPosition={(p) => seen.push(p)} />);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].side).toBe('bottom');
    expect(seen[0].align).toBe('start');
  });

  it('forwards getAnchorRect to usePosition', async () => {
    const getAnchorRect = vi.fn(() => ({
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }));
    render(<Harness open mount="unmount" getAnchorRect={getAnchorRect} />);
    await waitFor(() => expect(getAnchorRect).toHaveBeenCalled());
  });
});
