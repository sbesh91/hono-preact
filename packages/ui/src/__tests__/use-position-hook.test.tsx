// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { usePosition, type PositionState } from '../use-position.js';

afterEach(cleanup);

function Harness({ open }: { open: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const pos: PositionState = usePosition({
    open,
    anchorRef,
    floatingRef,
    side: 'bottom',
    align: 'center',
  });
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      {open ? (
        <div ref={floatingRef} data-testid="float" data-side={pos.side}>
          floating
        </div>
      ) : null}
    </div>
  );
}

describe('usePosition', () => {
  it('reports the requested side before any flip', () => {
    const { getByTestId } = render(<Harness open />);
    expect(getByTestId('float').getAttribute('data-side')).toBe('bottom');
  });

  it('sets position:fixed on the floating element when open', async () => {
    const { getByTestId } = render(<Harness open />);
    const float = getByTestId('float');
    // computePosition is deeply async (many awaits inside floating-ui's platform
    // calls); waitFor polls until the side-effect lands on the DOM element.
    await waitFor(() => {
      expect(float.style.position).toBe('fixed');
    });
  });

  it('does not throw when closed (floating element absent)', () => {
    expect(() => render(<Harness open={false} />)).not.toThrow();
  });
});
