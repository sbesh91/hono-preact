// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import {
  DialogRoot,
  DialogPopup,
  DialogTitle,
  DialogDescription,
} from '../dialog/dialog.js';

afterEach(cleanup);

describe('Dialog Title and Description', () => {
  it('Title renders an h2 carrying the title id', () => {
    const { container } = render(
      <DialogRoot open>
        <DialogPopup>
          <DialogTitle>Hello</DialogTitle>
        </DialogPopup>
      </DialogRoot>
    );
    const title = container.querySelector('h2')!;
    const dialog = container.querySelector('dialog')!;
    expect(title.textContent).toBe('Hello');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('wires aria-describedby only when a Description is rendered', () => {
    const { container } = render(
      <DialogRoot open>
        <DialogPopup aria-label="x">
          <DialogDescription>Details</DialogDescription>
        </DialogPopup>
      </DialogRoot>
    );
    const desc = container.querySelector('p')!;
    const dialog = container.querySelector('dialog')!;
    expect(desc.id).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBe(desc.id);
  });

  it('omits aria-describedby when no Description is present', () => {
    const { container } = render(
      <DialogRoot open>
        <DialogPopup aria-label="x">
          <p>plain</p>
        </DialogPopup>
      </DialogRoot>
    );
    expect(
      container.querySelector('dialog')!.getAttribute('aria-describedby')
    ).toBeNull();
  });
});
