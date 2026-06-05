// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  wrapNext,
  wrapPrev,
  matchTypeahead,
  getMenuItems,
  ITEM_SELECTOR,
} from '../menu/navigation.js';

describe('menu navigation math', () => {
  it('wrapNext advances and wraps when loop is true', () => {
    expect(wrapNext(0, 3, true)).toBe(1);
    expect(wrapNext(2, 3, true)).toBe(0);
    expect(wrapNext(-1, 3, true)).toBe(0);
  });
  it('wrapNext clamps at the end when loop is false', () => {
    expect(wrapNext(2, 3, false)).toBe(2);
  });
  it('wrapPrev retreats and wraps when loop is true', () => {
    expect(wrapPrev(0, 3, true)).toBe(2);
    expect(wrapPrev(2, 3, true)).toBe(1);
  });
  it('wrapPrev clamps at the start when loop is false', () => {
    expect(wrapPrev(0, 3, false)).toBe(0);
  });
});

describe('typeahead matching', () => {
  const labels = ['Cut', 'Copy', 'Paste', 'Delete'];
  it('matches the next label starting with the query (circular)', () => {
    expect(matchTypeahead(labels, 'p', 0)).toBe(2);
    expect(matchTypeahead(labels, 'c', 0)).toBe(1);
    expect(matchTypeahead(labels, 'c', 1)).toBe(0);
  });
  it('is case-insensitive and returns -1 on no match', () => {
    expect(matchTypeahead(labels, 'PA', 0)).toBe(2);
    expect(matchTypeahead(labels, 'z', 0)).toBe(-1);
  });
});

describe('getMenuItems', () => {
  it('returns enabled items scoped to the given surface, in DOM order', () => {
    document.body.innerHTML = `
      <div role="menu" id="m">
        <div role="menuitem" data-menu-item>A</div>
        <div role="menuitem" data-menu-item aria-disabled="true">B</div>
        <div role="separator"></div>
        <div role="menuitemcheckbox" data-menu-item>C</div>
        <div role="menu" id="sub">
          <div role="menuitem" data-menu-item>NESTED</div>
        </div>
      </div>`;
    const surface = document.getElementById('m')!;
    const items = getMenuItems(surface);
    expect(items.map((el) => el.textContent)).toEqual(['A', 'C']);
  });

  it('ITEM_SELECTOR targets the menu item roles', () => {
    expect(ITEM_SELECTOR).toContain('menu-item');
  });
});
