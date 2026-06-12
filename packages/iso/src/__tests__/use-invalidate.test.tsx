// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useInvalidate, type InvalidateInput } from '../use-invalidate.js';
import { ReloadContext } from '../reload-context.js';
import { ActiveLoaderIdContext } from '../internal/contexts.js';
import { defineLoader } from '../define-loader.js';

afterEach(cleanup);

function Harness({ input }: { input: InvalidateInput }) {
  const apply = useInvalidate();
  return <button onClick={() => apply(input)}>go</button>;
}

function click() {
  document.querySelector('button')!.click();
}

describe('useInvalidate', () => {
  it('calls reload() for "auto"', async () => {
    const reload = vi.fn();
    render(
      <ReloadContext.Provider value={{ reload, reloading: false }}>
        <Harness input="auto" />
      </ReloadContext.Provider>
    );
    await act(async () => click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does nothing for false', async () => {
    const reload = vi.fn();
    render(
      <ReloadContext.Provider value={{ reload, reloading: false }}>
        <Harness input={false} />
      </ReloadContext.Provider>
    );
    await act(async () => click());
    expect(reload).not.toHaveBeenCalled();
  });

  it('invalidates each ref in an array and reloads when the active loader is included', async () => {
    const active = defineLoader(async () => ({ value: 1 }), {
      __moduleKey: 'inv-active',
    });
    const other = defineLoader(async () => ({ value: 2 }), {
      __moduleKey: 'inv-other',
    });
    const invActive = vi.spyOn(active, 'invalidate');
    const invOther = vi.spyOn(other, 'invalidate');
    const reload = vi.fn();
    render(
      <ActiveLoaderIdContext.Provider value={active.__id}>
        <ReloadContext.Provider value={{ reload, reloading: false }}>
          <Harness input={[active, other]} />
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    );
    await act(async () => click());
    expect(invActive).toHaveBeenCalled();
    expect(invOther).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('invalidates refs without reloading when none is the active loader', async () => {
    const other = defineLoader(async () => ({ value: 2 }), {
      __moduleKey: 'inv-only-other',
    });
    const invOther = vi.spyOn(other, 'invalidate');
    const reload = vi.fn();
    render(
      <ActiveLoaderIdContext.Provider value={null}>
        <ReloadContext.Provider value={{ reload, reloading: false }}>
          <Harness input={[other]} />
        </ReloadContext.Provider>
      </ActiveLoaderIdContext.Provider>
    );
    await act(async () => click());
    expect(invOther).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
