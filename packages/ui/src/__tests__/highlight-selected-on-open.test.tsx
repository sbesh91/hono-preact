// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import {
  useHighlightSelectedOnOpen,
  type ListNavigation,
} from '../list-navigation.js';

afterEach(cleanup);

function makeNav(selectedFlags: boolean[]): {
  nav: ListNavigation;
  setActiveItem: ReturnType<typeof vi.fn>;
} {
  const setActiveItem = vi.fn();
  const els = selectedFlags.map((selected) => {
    const el = document.createElement('div');
    el.setAttribute('role', 'option');
    if (selected) el.setAttribute('aria-selected', 'true');
    return el;
  });
  const nav: ListNavigation = {
    onKeyDown: () => {},
    getItems: () => els,
    setActiveItem,
  };
  return { nav, setActiveItem };
}

function Probe(props: { nav: ListNavigation; open: boolean }) {
  useHighlightSelectedOnOpen(props.nav, props.open);
  return null;
}

describe('useHighlightSelectedOnOpen', () => {
  it('on open, activates the selected option', () => {
    const { nav, setActiveItem } = makeNav([false, true, false]);
    render(<Probe nav={nav} open />);
    expect(setActiveItem).toHaveBeenCalledWith(1);
  });

  it('on open with none selected, activates the first', () => {
    const { nav, setActiveItem } = makeNav([false, false]);
    render(<Probe nav={nav} open />);
    expect(setActiveItem).toHaveBeenCalledWith(0);
  });

  it('does nothing when closed', () => {
    const { nav, setActiveItem } = makeNav([true]);
    render(<Probe nav={nav} open={false} />);
    expect(setActiveItem).not.toHaveBeenCalled();
  });

  it('does nothing when the list is empty', () => {
    const { nav, setActiveItem } = makeNav([]);
    render(<Probe nav={nav} open />);
    expect(setActiveItem).not.toHaveBeenCalled();
  });
});
