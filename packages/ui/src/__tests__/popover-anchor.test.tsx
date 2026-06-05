// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { PopoverRoot, PopoverAnchor } from '../popover/popover.js';

afterEach(cleanup);

describe('Popover Anchor', () => {
  it('renders its children as the anchor element by default (a span)', () => {
    const { getByText } = render(
      <PopoverRoot>
        <PopoverAnchor>anchored here</PopoverAnchor>
      </PopoverRoot>
    );
    const el = getByText('anchored here');
    expect(el.tagName).toBe('SPAN');
  });
});
