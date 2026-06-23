// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Dialog } from '../dialog/index.js';

// startViewTransition is an optional member, so a plain Document is assignable
// here without a cast; the tests add/remove the stub on this typed view.
type VTDoc = Document & { startViewTransition?: (cb: () => void) => unknown };
const vtDoc: VTDoc = document;

// happy-dom implements neither the native modal behaviour nor View Transitions.
// Mirror the `open` attribute (like the other dialog tests) so `el.open`
// reflects state, and let each test opt into a synchronous startViewTransition.
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
    function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }
  );
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement
  ) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete vtDoc.startViewTransition;
});

// Run the transition callback synchronously so assertions can read the
// post-mutation DOM, and record each call.
function stubViewTransitions() {
  const start = vi.fn((cb: () => void) => {
    cb();
    return { finished: Promise.resolve(), ready: Promise.resolve() };
  });
  vtDoc.startViewTransition = start;
  return start;
}

const nameOf = (el: Element) =>
  (el as HTMLElement).style.getPropertyValue('view-transition-name');

describe('Dialog viewTransition mode', () => {
  it('parks the panel name on the trigger while closed', () => {
    stubViewTransitions();
    const { getByText, container } = render(
      <Dialog.Root viewTransition>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Popup aria-label="x" />
      </Dialog.Root>
    );
    const trigger = getByText('Open');
    const dialog = container.querySelector('dialog')!;
    expect(nameOf(trigger)).toMatch(/^hp-dialog-/);
    expect(nameOf(dialog)).toBe('');
  });

  it('opens inside a View Transition and hands the name to the dialog', () => {
    const start = stubViewTransitions();
    const { getByText, container } = render(
      <Dialog.Root viewTransition>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Popup aria-label="x" />
      </Dialog.Root>
    );
    const trigger = getByText('Open');
    const dialog = container.querySelector('dialog')!;
    const name = nameOf(trigger);

    fireEvent.click(trigger);

    expect(start).toHaveBeenCalledTimes(1);
    expect(dialog.getAttribute('open')).not.toBeNull(); // showModal ran
    // The name moved: dialog holds it, trigger released it, so the panel morphs
    // out of where the trigger was.
    expect(nameOf(dialog)).toBe(name);
    expect(nameOf(trigger)).toBe('');
  });

  it('closes inside a View Transition and returns the name to the trigger', () => {
    const start = stubViewTransitions();
    const { getByText, container } = render(
      <Dialog.Root viewTransition defaultOpen>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Popup aria-label="x">
          <Dialog.Close>Done</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Root>
    );
    const trigger = getByText('Open');
    const dialog = container.querySelector('dialog')!;
    // defaultOpen: the open ran in a transition on mount.
    expect(start).toHaveBeenCalledTimes(1);
    const name = nameOf(dialog);
    expect(name).toMatch(/^hp-dialog-/);

    fireEvent.click(getByText('Done'));

    expect(start).toHaveBeenCalledTimes(2);
    expect(dialog.getAttribute('open')).toBeNull(); // close ran
    expect(nameOf(trigger)).toBe(name);
    expect(nameOf(dialog)).toBe('');
  });

  it('still opens when View Transitions are unsupported (graceful fallback)', () => {
    // No stub installed: runViewTransition applies the change directly.
    const { getByText, container } = render(
      <Dialog.Root viewTransition>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Popup aria-label="x" />
      </Dialog.Root>
    );
    fireEvent.click(getByText('Open'));
    const dialog = container.querySelector('dialog')!;
    expect(dialog.getAttribute('open')).not.toBeNull();
    expect(dialog.getAttribute('data-state')).toBe('open');
  });

  it('uses a string viewTransition verbatim as the panel name (a stable CSS handle)', () => {
    stubViewTransitions();
    const { getByText, container } = render(
      <Dialog.Root viewTransition="my-panel">
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Popup aria-label="x" />
      </Dialog.Root>
    );
    const trigger = getByText('Open');
    const dialog = container.querySelector('dialog')!;
    // Resting: the exact provided name parks on the trigger (not auto-generated).
    expect(nameOf(trigger)).toBe('my-panel');

    fireEvent.click(trigger);
    // ...and moves verbatim to the dialog on open, so `::view-transition-group(
    // my-panel)` in CSS targets the panel's group throughout the transition.
    expect(nameOf(dialog)).toBe('my-panel');
    expect(nameOf(trigger)).toBe('');
  });
});
