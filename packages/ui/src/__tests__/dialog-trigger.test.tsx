// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { DialogRoot, DialogTrigger } from '../dialog/dialog.js';

// Testing Library auto-cleanup does not register without vitest `globals`, so
// unmount between cases or document-scoped queries find stale renders.
afterEach(cleanup);

describe('Dialog Root + Trigger', () => {
  it('renders a button trigger with dialog ARIA wiring', () => {
    const { getByText } = render(
      <DialogRoot>
        <DialogTrigger>Open</DialogTrigger>
      </DialogRoot>
    );
    const btn = getByText('Open');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBeTruthy();
    expect(btn.getAttribute('id')).toBeTruthy();
    expect(btn.getAttribute('data-state')).toBe('closed');
  });

  it('opening flips aria-expanded and data-state on the trigger', () => {
    const { getByText } = render(
      <DialogRoot>
        <DialogTrigger>Open</DialogTrigger>
      </DialogRoot>
    );
    const btn = getByText('Open');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('data-state')).toBe('open');
  });

  it('chains a consumer onClick before opening', () => {
    const onClick = vi.fn();
    const { getByText } = render(
      <DialogRoot>
        <DialogTrigger onClick={onClick}>Open</DialogTrigger>
      </DialogRoot>
    );
    fireEvent.click(getByText('Open'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('respects a controlled open prop', () => {
    const { getByText } = render(
      <DialogRoot open>
        <DialogTrigger>Open</DialogTrigger>
      </DialogRoot>
    );
    expect(getByText('Open').getAttribute('aria-expanded')).toBe('true');
  });
});
