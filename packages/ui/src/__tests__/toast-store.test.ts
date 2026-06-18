// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ToastStore, DEFAULT_DURATION } from '../toast/toast-store.js';

describe('ToastStore', () => {
  it('adds newest-first and assigns an id', () => {
    const store = new ToastStore();
    const a = store.add({ title: 'first' });
    const b = store.add({ title: 'second' });
    expect(store.toasts.map((t) => t.id)).toEqual([b, a]);
    expect(store.toasts[0].title).toBe('second');
    expect(store.toasts[1].duration).toBe(DEFAULT_DURATION);
    expect(store.toasts[0].dismissed).toBe(false);
  });

  it('updates a record in place when an existing id is reused', () => {
    const store = new ToastStore();
    const id = store.add({ title: 'loading', type: 'loading' });
    store.add({ id, title: 'done', type: 'success' });
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0]).toMatchObject({ title: 'done', type: 'success' });
  });

  it('marks dismissed (keeps the record for exit) and fires the right callback', () => {
    const store = new ToastStore();
    const onDismiss = vi.fn();
    const onAutoClose = vi.fn();
    const id = store.add({ title: 'x', onDismiss, onAutoClose });
    store.dismiss(id, 'user');
    expect(store.toasts[0].dismissed).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAutoClose).not.toHaveBeenCalled();

    const id2 = store.add({ title: 'y', onDismiss, onAutoClose });
    store.dismiss(id2, 'timeout');
    expect(onAutoClose).toHaveBeenCalledTimes(1);
  });

  it('dismiss() with no id marks every undismissed toast', () => {
    const store = new ToastStore();
    store.add({ title: 'a' });
    store.add({ title: 'b' });
    store.dismiss();
    expect(store.toasts.every((t) => t.dismissed)).toBe(true);
  });

  it('remove() deletes by id', () => {
    const store = new ToastStore();
    const id = store.add({ title: 'a' });
    store.remove(id);
    expect(store.toasts).toHaveLength(0);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const store = new ToastStore();
    const seen = vi.fn();
    const unsub = store.subscribe(seen);
    store.add({ title: 'a' });
    expect(seen).toHaveBeenCalledTimes(1);
    unsub();
    store.add({ title: 'b' });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
