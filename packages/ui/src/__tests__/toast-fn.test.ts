// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';

function reset() {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
}

describe('toast()', () => {
  it('adds a default toast and returns its id', () => {
    reset();
    const id = toast('Saved');
    const rec = toastStore.toasts.find((t) => t.id === id);
    expect(rec?.type).toBe('default');
    expect(rec?.title).toBe('Saved');
  });

  it('variant helpers set the type; error is important', () => {
    reset();
    toast.success('ok');
    toast.error('bad');
    const types = toastStore.toasts.map((t) => t.type);
    expect(types).toContain('success');
    expect(types).toContain('error');
    const err = toastStore.toasts.find((t) => t.type === 'error');
    expect(err?.important).toBe(true);
  });

  it('passes description and duration through options', () => {
    reset();
    const id = toast('Title', { description: 'more', duration: 1000 });
    const rec = toastStore.toasts.find((t) => t.id === id);
    expect(rec?.description).toBe('more');
    expect(rec?.duration).toBe(1000);
  });

  it('custom() stores a render function and type=custom', () => {
    reset();
    const id = toast.custom(() => null as never);
    const rec = toastStore.toasts.find((t) => t.id === id);
    expect(rec?.type).toBe('custom');
    expect(typeof rec?.jsx).toBe('function');
  });

  it('dismiss(id) marks that toast dismissed', () => {
    reset();
    const id = toast('x');
    toast.dismiss(id);
    expect(toastStore.toasts.find((t) => t.id === id)?.dismissed).toBe(true);
  });
});
