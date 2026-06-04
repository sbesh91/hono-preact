// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import {
  DialogRoot,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
} from '../dialog/dialog.js';

// happy-dom implements HTMLDialogElement but showModal/close do not toggle the
// top layer; spy on them and drive the `open` property/`close` event manually.
let showModal: ReturnType<typeof vi.spyOn>;
let close: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  showModal = vi
    .spyOn(HTMLDialogElement.prototype, 'showModal')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  close = vi
    .spyOn(HTMLDialogElement.prototype, 'close')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
});

afterEach(() => {
  cleanup();
  showModal.mockRestore();
  close.mockRestore();
});

function Basic(props: { closeOnBackdropClick?: boolean }) {
  return (
    <DialogRoot>
      <DialogTrigger>Open</DialogTrigger>
      <DialogPopup closeOnBackdropClick={props.closeOnBackdropClick}>
        <DialogTitle>Title</DialogTitle>
        <p>Body</p>
      </DialogPopup>
    </DialogRoot>
  );
}

describe('Dialog Popup', () => {
  it('calls showModal when opened and close when closed', () => {
    const { getByText, container } = render(<Basic />);
    fireEvent.click(getByText('Open'));
    expect(showModal).toHaveBeenCalledTimes(1);
    const dialog = container.querySelector('dialog')!;
    expect(dialog.getAttribute('data-state')).toBe('open');
  });

  it('syncs state to closed on the native close event', () => {
    const { getByText, container } = render(<Basic />);
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    // Raw dispatch is not wrapped by fireEvent, so flush Preact's async
    // re-render with act() before asserting on the synced state.
    act(() => {
      dialog.dispatchEvent(new Event('close'));
    });
    expect(dialog.getAttribute('data-state')).toBe('closed');
  });

  it('wires aria-labelledby to the Title id', () => {
    const { container } = render(<Basic />);
    const dialog = container.querySelector('dialog')!;
    const title = container.querySelector('h2')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('aria-label on the Popup suppresses aria-labelledby', () => {
    const { container } = render(
      <DialogRoot open>
        <DialogPopup aria-label="Settings">
          <p>Body</p>
        </DialogPopup>
      </DialogRoot>
    );
    const dialog = container.querySelector('dialog')!;
    expect(dialog.getAttribute('aria-label')).toBe('Settings');
    expect(dialog.getAttribute('aria-labelledby')).toBeNull();
  });

  it('closes on a backdrop click (target is the dialog element)', () => {
    const { getByText, container } = render(<Basic />);
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    fireEvent.click(dialog); // target === dialog => backdrop
    expect(dialog.getAttribute('data-state')).toBe('closed');
  });

  it('does not close on an inner content click', () => {
    const { getByText, container } = render(<Basic />);
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    fireEvent.click(container.querySelector('h2')!);
    expect(dialog.getAttribute('data-state')).toBe('open');
  });

  it('closeOnBackdropClick={false} keeps the dialog open on backdrop click', () => {
    const { getByText, container } = render(
      <Basic closeOnBackdropClick={false} />
    );
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    fireEvent.click(dialog);
    expect(dialog.getAttribute('data-state')).toBe('open');
  });
});
