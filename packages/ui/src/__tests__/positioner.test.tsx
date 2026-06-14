// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { Positioner } from '../positioner.js';
import { Arrow } from '../arrow.js';

afterEach(cleanup);

function Harness(props: { open: boolean; mount: 'unmount' | 'hidden' }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <Positioner
        open={props.open}
        anchorRef={anchorRef}
        floatingRef={floatingRef}
        side="bottom"
        align="start"
        offset={8}
        mount={props.mount}
        data-testid="positioner"
      >
        <Arrow data-testid="arrow" />
      </Positioner>
    </div>
  );
}

describe('Positioner', () => {
  it('unmount mode: renders nothing when closed, the element when open', () => {
    const closed = render(<Harness open={false} mount="unmount" />);
    expect(closed.queryByTestId('positioner')).toBeNull();
    cleanup();
    const open = render(<Harness open mount="unmount" />);
    expect(open.queryByTestId('positioner')).not.toBeNull();
    expect(open.getByTestId('positioner').getAttribute('data-side')).toBe(
      'bottom'
    );
  });

  it('hidden mode: always renders, hidden while closed', () => {
    const closed = render(<Harness open={false} mount="hidden" />);
    const el = closed.getByTestId('positioner');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
  });

  it('provides PositionerContext so a nested Arrow renders', () => {
    const { getByTestId } = render(<Harness open mount="unmount" />);
    expect(getByTestId('arrow').getAttribute('data-side')).toBe('bottom');
  });
});
