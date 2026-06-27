// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/preact';
import { useStoreSnapshot } from '../use-store-snapshot.js';

describe('useStoreSnapshot', () => {
  it('reads snapshot and re-renders on store change', async () => {
    let value = 'a';
    const listeners = new Set<() => void>();
    const subscribe = (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    };
    const set = (v: string) => {
      value = v;
      listeners.forEach((l) => l());
    };
    const View = () => <span>{useStoreSnapshot(subscribe, () => value)}</span>;
    const { getByText } = render(<View />);
    expect(getByText('a')).toBeTruthy();
    set('b');
    await waitFor(() => expect(getByText('b')).toBeTruthy());
  });
});

describe('useStoreSnapshot equality bailout + tear window', () => {
  it('does not re-render when the snapshot is unchanged (Object.is bailout)', () => {
    const listeners = new Set<() => void>();
    const subscribe = (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    };
    const broadcast = () => listeners.forEach((l) => l());

    let renders = 0;
    function Probe() {
      renders++;
      useStoreSnapshot(subscribe, () => 'constant');
      return null;
    }
    render(<Probe />);
    expect(renders).toBe(1);
    act(() => broadcast()); // snapshot unchanged -> no re-render
    expect(renders).toBe(1);
    cleanup();
  });

  it('re-reads the snapshot at subscribe time (commit->effect tear window)', () => {
    let snapshot = 'a';
    const listeners = new Set<() => void>();
    const subscribe = (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    };
    // Mutate the store DURING render, before the subscribe effect runs.
    let mutatedOnce = false;
    function Probe() {
      const v = useStoreSnapshot(subscribe, () => snapshot);
      if (!mutatedOnce) {
        mutatedOnce = true;
        snapshot = 'b'; // write lands in the render->effect window
      }
      return <span>{v}</span>;
    }
    const { container } = render(<Probe />);
    // The subscribe-time re-read must catch the 'b' write and re-render.
    expect(container.textContent).toBe('b');
    cleanup();
  });
});
