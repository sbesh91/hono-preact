// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useSafeArea } from '../use-safe-area.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function rect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

function Harness({
  enabled,
  onClose,
  graceMs,
}: {
  enabled: boolean;
  onClose: () => void;
  graceMs?: number;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  useSafeArea({ enabled, anchorRef, floatingRef, onClose, graceMs });
  return (
    <div>
      <div ref={anchorRef}>anchor</div>
      <div ref={floatingRef}>floating</div>
    </div>
  );
}

function stub(getByText: (t: string) => HTMLElement) {
  getByText('anchor').getBoundingClientRect = () => rect(0, 0, 100, 50);
  getByText('floating').getBoundingClientRect = () => rect(200, 0, 100, 150);
}

const move = (clientX: number, clientY: number) =>
  fireEvent.pointerMove(document, { clientX, clientY, pointerType: 'mouse' });

describe('useSafeArea', () => {
  it('does not close before the pointer has touched a reference (engaged gate)', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <Harness enabled onClose={onClose} graceMs={300} />
    );
    stub(getByText);
    move(150, 130); // gap, outside corridor, but no reference hit yet
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes immediately when the pointer leaves the corridor', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <Harness enabled onClose={onClose} graceMs={300} />
    );
    stub(getByText);
    move(50, 25); // over the anchor -> engaged
    move(150, 130); // gap, outside corridor
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open inside the corridor, then closes on grace expiry', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <Harness enabled onClose={onClose} graceMs={300} />
    );
    stub(getByText);
    move(50, 25); // engaged
    move(150, 25); // inside corridor -> arms grace
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm the grace timer on continued movement in the corridor', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <Harness enabled onClose={onClose} graceMs={300} />
    );
    stub(getByText);
    move(50, 25); // engaged
    move(150, 25); // inside corridor -> arms grace at t=0
    act(() => vi.advanceTimersByTime(200)); // t=200, still pending
    move(150, 30); // still inside; must NOT reset the deadline
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100)); // t=300 from arm -> fires
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears the grace timer when the pointer reaches the floating element', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <Harness enabled onClose={onClose} graceMs={300} />
    );
    stub(getByText);
    move(50, 25); // engaged
    move(150, 25); // inside corridor -> arms grace
    move(250, 75); // over the floating element -> clears grace
    act(() => vi.advanceTimersByTime(300));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores touch pointers', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <Harness enabled onClose={onClose} graceMs={300} />
    );
    stub(getByText);
    fireEvent.pointerMove(document, {
      clientX: 50,
      clientY: 25,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(document, {
      clientX: 150,
      clientY: 130,
      pointerType: 'touch',
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening once disabled', () => {
    const onClose = vi.fn();
    const { getByText, rerender } = render(
      <Harness enabled onClose={onClose} graceMs={300} />
    );
    stub(getByText);
    move(50, 25); // engaged
    rerender(<Harness enabled={false} onClose={onClose} graceMs={300} />);
    move(150, 130); // would close if still listening
    expect(onClose).not.toHaveBeenCalled();
  });
});
