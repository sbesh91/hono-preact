// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ChapterMutations } from '../ChapterMutations.js';

// A >=6-word exact substring of the real desc copy.
const CLAIM = 'The UI patches the instant you submit and the server reconciles';

function stubMatchMedia(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && /reduce/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', NoopObserver);
  vi.stubGlobal('ResizeObserver', NoopObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChapterMutations', () => {
  it('renders the heading, the claim copy, and the mutation device UI', () => {
    stubMatchMedia(false);
    const { container, getByText } = render(<ChapterMutations />);

    const heading = getByText('Mutations without the cliff.');
    expect(heading.tagName).toBe('H2');
    expect(heading.className).toContain('hx-scene__title');

    const desc = container.querySelector('.hx-scene__desc');
    expect(desc?.textContent ?? '').toContain(CLAIM);

    // Device chapter: the browser frame renders the task list plus the Add control.
    expect(container.querySelector('.hx-mut-list')).not.toBeNull();
    expect(container.querySelector('.hx-mut-row')).not.toBeNull();
    expect(container.querySelector('.hx-mut-add')).not.toBeNull();

    // The "why it matters" reasoning list is present.
    expect(container.querySelectorAll('.hx-why__item').length).toBe(4);
  });

  it('still renders the heading, copy, and device frame with reduced motion (static frame)', () => {
    stubMatchMedia(true);
    const { container, getByText } = render(<ChapterMutations />);

    const heading = getByText('Mutations without the cliff.');
    expect(heading.tagName).toBe('H2');

    const desc = container.querySelector('.hx-scene__desc');
    expect(desc?.textContent ?? '').toContain(CLAIM);

    // The static frame still renders the mutation device UI.
    expect(container.querySelector('.hx-mut-list')).not.toBeNull();
  });
});
