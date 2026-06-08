// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { usePresence } from '../use-presence.js';
import {
  makeAnimation,
  installGetAnimations,
  installReducedMotion,
} from './presence-helpers.js';

afterEach(cleanup);

function Harness({
  present,
  onExitComplete,
}: {
  present: boolean;
  onExitComplete?: () => void;
}) {
  const p = usePresence(present, { onExitComplete });
  return (
    <div>
      <span data-testid="status">{p.status}</span>
      {p.isPresent ? (
        <div
          ref={p.ref}
          data-testid="box"
          data-state={p.status === 'open' ? 'open' : 'closed'}
        />
      ) : null}
    </div>
  );
}

describe('usePresence', () => {
  it('renders open immediately when present is true', () => {
    const { getByTestId } = render(<Harness present />);
    expect(getByTestId('status').textContent).toBe('open');
    expect(getByTestId('box').getAttribute('data-state')).toBe('open');
  });

  it('renders nothing when present is false on first mount (no exit on mount)', () => {
    const { getByTestId, queryByTestId } = render(<Harness present={false} />);
    expect(getByTestId('status').textContent).toBe('closed');
    expect(queryByTestId('box')).toBeNull();
  });

  it('finalizes synchronously when there is no animation (empty set)', async () => {
    const restore = installGetAnimations([]);
    const { rerender, queryByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    expect(queryByTestId('box')).toBeNull();
    restore();
  });

  it('stays present in closing while an animation runs, then unmounts', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { rerender, getByTestId, queryByTestId } = render(
      <Harness present />
    );
    await act(async () => rerender(<Harness present={false} />));
    expect(getByTestId('status').textContent).toBe('closing');
    expect(getByTestId('box').getAttribute('data-state')).toBe('closed');
    await act(async () => {
      anim.resolve();
    });
    expect(queryByTestId('box')).toBeNull();
    restore();
  });

  it('fires onExitComplete before unmounting', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const seenWhileMounted: boolean[] = [];
    const onExitComplete = vi.fn(() => {
      seenWhileMounted.push(
        document.querySelector('[data-testid="box"]') != null
      );
    });
    const { rerender } = render(
      <Harness present onExitComplete={onExitComplete} />
    );
    await act(async () =>
      rerender(<Harness present={false} onExitComplete={onExitComplete} />)
    );
    await act(async () => {
      anim.resolve();
    });
    expect(onExitComplete).toHaveBeenCalledTimes(1);
    expect(seenWhileMounted).toEqual([true]);
    restore();
  });

  it('cancels the exit and stays open when reopened mid-exit', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { rerender, getByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    expect(getByTestId('status').textContent).toBe('closing');
    await act(async () => rerender(<Harness present />));
    expect(getByTestId('status').textContent).toBe('open');
    await act(async () => {
      anim.resolve();
    });
    expect(getByTestId('box').getAttribute('data-state')).toBe('open');
    restore();
  });

  it('finalizes synchronously under prefers-reduced-motion', async () => {
    const anim = makeAnimation();
    const restoreAnim = installGetAnimations([anim]);
    const restoreRM = installReducedMotion(true);
    const { rerender, queryByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    expect(queryByTestId('box')).toBeNull();
    restoreRM();
    restoreAnim();
  });

  it('ignores infinite-iteration animations (treats as empty)', async () => {
    const anim = makeAnimation({ iterations: Infinity });
    const restore = installGetAnimations([anim]);
    const { rerender, queryByTestId } = render(<Harness present />);
    await act(async () => rerender(<Harness present={false} />));
    expect(queryByTestId('box')).toBeNull();
    restore();
  });

  it('finalizes via the timeout when an animation never resolves', async () => {
    vi.useFakeTimers();
    const anim = makeAnimation({ endTime: 200 });
    const restore = installGetAnimations([anim]);
    const { rerender, queryByTestId } = render(<Harness present />);
    rerender(<Harness present={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(queryByTestId('box')).toBeNull();
    restore();
    vi.useRealTimers();
  });

  it('does not finalize twice when the timeout fires then a late animation settles', async () => {
    vi.useFakeTimers();
    const a1 = makeAnimation({ endTime: 100 });
    const a2 = makeAnimation({ endTime: 100 });
    const restore = installGetAnimations([a1, a2]);
    const onExitComplete = vi.fn();
    const Wrapper = ({ present }: { present: boolean }) => {
      const p = usePresence(present, { onExitComplete });
      return p.isPresent ? <div ref={p.ref} data-testid="box" /> : null;
    };
    const { rerender, queryByTestId } = render(<Wrapper present />);
    rerender(<Wrapper present={false} />);
    await act(async () => {
      a1.resolve();
      await vi.advanceTimersByTimeAsync(500); // timeout fires -> finalize once
    });
    expect(queryByTestId('box')).toBeNull();
    await act(async () => {
      a2.resolve(); // late settle must NOT finalize again
    });
    expect(onExitComplete).toHaveBeenCalledTimes(1);
    restore();
    vi.useRealTimers();
  });
});
