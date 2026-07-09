// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { ChapterStreaming } from '../ChapterStreaming.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// A >=6-word contiguous slice of the real desc copy.
const DESC_SUBSTRING = 'folds into the live UI the moment it lands';

describe('ChapterStreaming', () => {
  it('renders the heading, the streaming claim, and the device body', () => {
    const { container } = render(<ChapterStreaming />);

    const heading = container.querySelector('h2.hx-scene__title');
    expect(heading?.textContent).toBe('Data that streams in.');

    const desc = container.querySelector('p.hx-scene__desc');
    expect(desc?.textContent).toContain(DESC_SUBSTRING);

    // Device chapter: the streaming body mounts inside the BrowserFrame.
    expect(container.querySelector('.hx-stream')).not.toBeNull();
    expect(container.querySelector('.hx-browser')).not.toBeNull();
  });

  it('still renders heading and copy with reduced motion (static frame)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }));

    const { container } = render(<ChapterStreaming />);

    expect(container.querySelector('h2.hx-scene__title')?.textContent).toBe(
      'Data that streams in.'
    );
    expect(container.querySelector('p.hx-scene__desc')?.textContent).toContain(
      DESC_SUBSTRING
    );
  });
});
