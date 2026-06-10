// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useMenuCore, type UseMenuCoreOptions } from '../menu/use-menu-core.js';
import type { MenuContextValue } from '../menu/context.js';

afterEach(cleanup);

const BASE: UseMenuCoreOptions = {
  side: 'bottom',
  align: 'start',
  offset: 8,
  loop: true,
  typeahead: true,
};

function renderCore(opts: UseMenuCoreOptions) {
  const cap: { ctx: MenuContextValue } = {
    ctx: undefined as unknown as MenuContextValue,
  };
  function Harness() {
    const core = useMenuCore(opts);
    cap.ctx = core.menuCtx;
    return <span data-testid="open">{String(core.open)}</span>;
  }
  const utils = render(<Harness />);
  return { cap, utils };
}

describe('useMenuCore', () => {
  it('closeAll defaults to setOpen(false)', () => {
    const { cap, utils } = renderCore({ ...BASE, defaultOpen: true });
    expect(cap.ctx.open).toBe(true);
    act(() => cap.ctx.closeAll());
    expect(utils.getByTestId('open').textContent).toBe('false');
  });

  it('uses an injected closeAll instead of the default', () => {
    const closeAll = vi.fn();
    const { cap, utils } = renderCore({ ...BASE, defaultOpen: true, closeAll });
    act(() => cap.ctx.closeAll());
    expect(closeAll).toHaveBeenCalledTimes(1);
    // open is unchanged: the injected closeAll did not touch our state
    expect(utils.getByTestId('open').textContent).toBe('true');
  });

  it('passes through parentDismissId (default null)', () => {
    const a = renderCore({ ...BASE });
    expect(a.cap.ctx.parentDismissId).toBeNull();
    cleanup();
    const b = renderCore({ ...BASE, parentDismissId: 'parent-9' });
    expect(b.cap.ctx.parentDismissId).toBe('parent-9');
  });

  it('pointerAnchored: openAt captures the point, opens, pends first; getAnchorRect returns the point rect', () => {
    const { cap, utils } = renderCore({ ...BASE, pointerAnchored: true });
    expect(cap.ctx.open).toBe(false);
    const { openAt, getAnchorRect } = cap.ctx;
    expect(openAt).toBeTypeOf('function');
    expect(getAnchorRect).toBeTypeOf('function');
    act(() => openAt?.(10, 20));
    expect(utils.getByTestId('open').textContent).toBe('true');
    expect(cap.ctx.pendingEdgeRef.current).toBe('first');
    expect(getAnchorRect?.()).toMatchObject({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      right: 10,
      bottom: 20,
      width: 0,
      height: 0,
    });
  });

  it('without pointerAnchored, getAnchorRect and openAt are undefined', () => {
    const { cap } = renderCore({ ...BASE });
    expect(cap.ctx.getAnchorRect).toBeUndefined();
    expect(cap.ctx.openAt).toBeUndefined();
  });
});
