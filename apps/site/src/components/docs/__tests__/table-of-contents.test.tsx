// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { TableOfContents } from '../TableOfContents.js';
import type { DocHeading } from '../../../llms/docs-index.js';

const headings: DocHeading[] = [
  { id: 'intro', text: 'Intro', depth: 2 },
  { id: 'usage', text: 'Usage', depth: 2 },
];

beforeEach(() => {
  history.replaceState(null, '', '/docs/x');
  Element.prototype.scrollIntoView = vi.fn();
  document.getElementById = ((id: string) => {
    const el = document.createElement('div');
    el.id = id;
    return el;
  }) as never;
});
afterEach(() => cleanup());

describe('TableOfContents', () => {
  it('writes the section hash to the URL on a plain left-click', () => {
    const { getByText } = render(h(TableOfContents, { headings }));
    fireEvent.click(getByText('Usage'), { button: 0 });
    expect(location.hash).toBe('#usage');
  });
});
