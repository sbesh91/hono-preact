// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
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
