// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { useInvalidate } from '../use-invalidate.js';
import { ReloadContext } from '../reload-context.js';
import { ActiveLoaderIdContext } from '../internal/contexts.js';
import type { AnyLoaderRef } from '../define-loader.js';

function makeRef(id: symbol): AnyLoaderRef {
  return { __id: id, invalidate: vi.fn() } as unknown as AnyLoaderRef;
}

// ReloadContextValue is `{ reload: () => void; reloading: boolean }` (see
// reload-context.tsx), and ActiveLoaderIdContext is `createContext<symbol | null>(null)`.
// Both shapes are exact; do not simplify them or the provider will not typecheck.
function wrapper(reload: () => void, activeId: symbol | null) {
  return ({ children }: { children: ComponentChildren }) => (
    <ReloadContext.Provider value={{ reload, reloading: false }}>
      <ActiveLoaderIdContext.Provider value={activeId}>
        {children}
      </ActiveLoaderIdContext.Provider>
    </ReloadContext.Provider>
  );
}

describe('useInvalidate', () => {
  it('refetchActive: true reloads without clearing anything', () => {
    const reload = vi.fn();
    const { result } = renderHook(() => useInvalidate(), {
      wrapper: wrapper(reload, Symbol('active')),
    });
    result.current({ refetchActive: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clear calls invalidate() on each ref', () => {
    const reload = vi.fn();
    const a = makeRef(Symbol('a'));
    const b = makeRef(Symbol('b'));
    const { result } = renderHook(() => useInvalidate(), {
      wrapper: wrapper(reload, Symbol('active')),
    });
    result.current({ clear: [a, b] });
    expect(a.invalidate).toHaveBeenCalledTimes(1);
    expect(b.invalidate).toHaveBeenCalledTimes(1);
    // Active loader is not in the list, so no reload.
    expect(reload).not.toHaveBeenCalled();
  });

  it('clear containing the active loader also reloads (default refetchActive)', () => {
    const reload = vi.fn();
    const activeId = Symbol('active');
    const active = makeRef(activeId);
    const { result } = renderHook(() => useInvalidate(), {
      wrapper: wrapper(reload, activeId),
    });
    result.current({ clear: [active] });
    expect(active.invalidate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('explicit refetchActive: false suppresses the reload even when active is cleared', () => {
    const reload = vi.fn();
    const activeId = Symbol('active');
    const active = makeRef(activeId);
    const { result } = renderHook(() => useInvalidate(), {
      wrapper: wrapper(reload, activeId),
    });
    result.current({ clear: [active], refetchActive: false });
    expect(active.invalidate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('undefined does nothing', () => {
    const reload = vi.fn();
    const { result } = renderHook(() => useInvalidate(), {
      wrapper: wrapper(reload, Symbol('active')),
    });
    result.current(undefined);
    expect(reload).not.toHaveBeenCalled();
  });

  it('clear plus refetchActive: true reloads even when active is not in the list', () => {
    const reload = vi.fn();
    const other = makeRef(Symbol('other'));
    const { result } = renderHook(() => useInvalidate(), {
      wrapper: wrapper(reload, Symbol('active')),
    });
    result.current({ clear: [other], refetchActive: true });
    expect(other.invalidate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
