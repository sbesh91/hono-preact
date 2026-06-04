// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Dialog } from '../dialog/index.js';

let close: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
    function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }
  );
  close = vi
    .spyOn(HTMLDialogElement.prototype, 'close')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Dialog.Close and the namespace', () => {
  it('exposes every part on the Dialog namespace', () => {
    expect(typeof Dialog.Root).toBe('function');
    expect(typeof Dialog.Trigger).toBe('function');
    expect(typeof Dialog.Popup).toBe('function');
    expect(typeof Dialog.Title).toBe('function');
    expect(typeof Dialog.Description).toBe('function');
    expect(typeof Dialog.Close).toBe('function');
  });

  it('Close button closes the dialog', () => {
    const { getByText, container } = render(
      <Dialog.Root defaultOpen>
        <Dialog.Popup aria-label="x">
          <Dialog.Close>Done</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Root>
    );
    fireEvent.click(getByText('Done'));
    expect(close).toHaveBeenCalled();
    expect(container.querySelector('dialog')!.getAttribute('data-state')).toBe(
      'closed'
    );
  });

  it('render prop swaps the element and merges props on a part', () => {
    const { getByTestId } = render(
      <Dialog.Root>
        <Dialog.Trigger render={<a data-testid="link" href="#x" />}>
          Open
        </Dialog.Trigger>
      </Dialog.Root>
    );
    const link = getByTestId('link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('aria-haspopup')).toBe('dialog');
    expect(link.getAttribute('href')).toBe('#x');
  });
});
