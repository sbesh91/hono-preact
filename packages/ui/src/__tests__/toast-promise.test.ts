// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toast } from '../toast/toast.js';
import { toastStore, DEFAULT_DURATION } from '../toast/toast-store.js';

function find(id: string | number) {
  return toastStore.toasts.find((t) => t.id === id);
}

describe('toast.promise', () => {
  it('starts loading (sticky) then resolves to success', async () => {
    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => (resolve = r));
    const id = toast.promise(p, {
      loading: 'Saving',
      success: (v) => `Saved ${v}`,
      error: 'Failed',
    });
    expect(find(id)).toMatchObject({ type: 'loading', title: 'Saving' });
    expect(find(id)?.duration).toBe(Infinity);

    resolve('row');
    await p;
    await Promise.resolve();
    expect(find(id)).toMatchObject({ type: 'success', title: 'Saved row' });
    expect(find(id)?.duration).toBe(DEFAULT_DURATION);
  });

  it('rejects to an important error toast', async () => {
    const p = Promise.reject(new Error('nope'));
    const id = toast.promise(p, {
      loading: 'Loading',
      success: 'ok',
      error: (e) => `Error: ${(e as Error).message}`,
    });
    await p.catch(() => undefined);
    await Promise.resolve();
    expect(find(id)).toMatchObject({ type: 'error', title: 'Error: nope' });
    expect(find(id)?.important).toBe(true);
  });
});
