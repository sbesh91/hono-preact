// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { useListNavigation, getItems, wrapNext } from '../list-navigation.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('getItems', () => {
  it('returns enabled items matching the selector, in DOM order', () => {
    document.body.innerHTML = `
      <div id="c">
        <div role="option" data-x>A</div>
        <div role="option" data-x aria-disabled="true">B</div>
        <div role="option" data-x>C</div>
      </div>`;
    const c = document.getElementById('c')!;
    const items = getItems(c, '[data-x]:not([aria-disabled="true"])');
    expect(items.map((e) => e.textContent)).toEqual(['A', 'C']);
  });
});

function Harness({ mode }: { mode: 'roving' | 'activedescendant' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const nav = useListNavigation({
    enabled: true,
    containerRef,
    itemSelector: '[role="option"]:not([aria-disabled="true"])',
    activeId,
    setActiveId,
    mode,
  });
  return (
    <div>
      <div
        data-testid="focusable"
        tabIndex={0}
        aria-activedescendant={
          mode === 'activedescendant' ? (activeId ?? undefined) : undefined
        }
        onKeyDown={(e) => nav.onKeyDown(e)}
      >
        focusable
      </div>
      <div ref={containerRef}>
        <div role="option" id="o1">
          Apple
        </div>
        <div role="option" id="o2">
          Banana
        </div>
        <div role="option" id="o3">
          Cherry
        </div>
      </div>
    </div>
  );
}

describe('useListNavigation', () => {
  it('activedescendant: ArrowDown advances the active id without moving focus', () => {
    const { getByTestId } = render(<Harness mode="activedescendant" />);
    const host = getByTestId('focusable');
    host.focus();
    fireEvent.keyDown(host, { key: 'ArrowDown' });
    expect(host.getAttribute('aria-activedescendant')).toBe('o1');
    expect(document.activeElement).toBe(host);
    fireEvent.keyDown(host, { key: 'ArrowDown' });
    expect(host.getAttribute('aria-activedescendant')).toBe('o2');
  });

  it('roving: ArrowDown moves DOM focus to the active item', () => {
    const { getByTestId, getByText } = render(<Harness mode="roving" />);
    const host = getByTestId('focusable');
    host.focus();
    fireEvent.keyDown(host, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByText('Apple'));
  });

  it('typeahead jumps to the matching item (space is not typeahead)', () => {
    const { getByTestId } = render(<Harness mode="activedescendant" />);
    const host = getByTestId('focusable');
    host.focus();
    fireEvent.keyDown(host, { key: 'c' });
    expect(host.getAttribute('aria-activedescendant')).toBe('o3');
  });
});
