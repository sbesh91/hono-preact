// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { PopoverRoot, PopoverTrigger } from '../popover/popover.js';

afterEach(cleanup);

describe('Popover Root + Trigger', () => {
  it('renders a button trigger with popover ARIA wiring', () => {
    const { getByText } = render(
      <PopoverRoot>
        <PopoverTrigger>Open</PopoverTrigger>
      </PopoverRoot>
    );
    const btn = getByText('Open');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // The popup is mount-on-open, so aria-controls is omitted while closed
    // (no dangling reference to a non-existent element).
    expect(btn.getAttribute('aria-controls')).toBeNull();
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  it('toggling the trigger flips open state and wires aria-controls', () => {
    const { getByText } = render(
      <PopoverRoot>
        <PopoverTrigger>Open</PopoverTrigger>
      </PopoverRoot>
    );
    const btn = getByText('Open');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('data-state')).toBe('open');
    expect(btn.getAttribute('aria-controls')).toBeTruthy();
  });

  it('respects a controlled open prop', () => {
    const { getByText } = render(
      <PopoverRoot open>
        <PopoverTrigger>Open</PopoverTrigger>
      </PopoverRoot>
    );
    expect(getByText('Open').getAttribute('aria-expanded')).toBe('true');
  });
});
