// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { usePositioner } from '../use-positioner.js';
import type { ClientRectGetter } from '../use-position.js';

afterEach(cleanup);

function Harness(props: {
  open: boolean;
  mount: 'unmount' | 'hidden';
  getAnchorRect?: ClientRectGetter;
  onSide?: (side: string) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const { isPresent, positionerProps, position, arrowRef } = usePositioner({
    open: props.open,
    anchorRef,
    floatingRef,
    side: 'bottom',
    align: 'start',
    offset: 8,
    getAnchorRect: props.getAnchorRect,
    mount: props.mount,
  });
  props.onSide?.(position.side);
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <span data-testid="present">{String(isPresent)}</span>
      <span data-testid="has-arrow-ref">{String(arrowRef != null)}</span>
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

  it('returns the resolved position and owns an arrow ref', () => {
    const seen: string[] = [];
    const { getByTestId } = render(
      <Harness open mount="unmount" onSide={(s) => seen.push(s)} />
    );
    expect(getByTestId('has-arrow-ref').textContent).toBe('true');
    expect(seen[seen.length - 1]).toBe('bottom');
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
