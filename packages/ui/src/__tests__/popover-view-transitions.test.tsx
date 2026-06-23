// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPositioner,
  PopoverPopup,
  PopoverClose,
} from '../popover/popover.js';

// startViewTransition is an optional member, so a plain Document is assignable
// here without a cast; the tests add/remove the stub on this typed view.
type VTDoc = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => unknown;
};
const vtDoc: VTDoc = document;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete vtDoc.startViewTransition;
});

// Run the transition callback immediately. The open callback is async (it awaits
// floating-ui placement via rAF); we don't await it here — the assertions only
// need the synchronous prefix (the state change) and that the transition ran.
function stubViewTransitions() {
  const start = vi.fn((cb: () => void | Promise<void>) => {
    void cb();
    return { finished: Promise.resolve(), ready: Promise.resolve() };
  });
  vtDoc.startViewTransition = start;
  return start;
}

const nameOf = (el: Element) =>
  (el as HTMLElement).style.getPropertyValue('view-transition-name');

function Example(props: { viewTransition?: boolean | string }) {
  return (
    <PopoverRoot viewTransition={props.viewTransition}>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverPositioner>
        <PopoverPopup aria-label="Menu">
          <PopoverClose>Close</PopoverClose>
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverRoot>
  );
}

describe('Popover viewTransition mode', () => {
  it('parks a string panel name on the trigger while closed', () => {
    stubViewTransitions();
    const { getByText } = render(<Example viewTransition="vt-pop" />);
    expect(nameOf(getByText('Open'))).toBe('vt-pop');
  });

  it('opens inside a View Transition (popup mounts)', () => {
    const start = stubViewTransitions();
    const { getByText, queryByRole } = render(
      <Example viewTransition="vt-pop" />
    );
    fireEvent.click(getByText('Open'));
    expect(start).toHaveBeenCalledTimes(1);
    expect(queryByRole('dialog')).not.toBeNull(); // popup mounted on open
  });

  it('closes inside a View Transition: returns the name to the trigger and leaves the top layer', () => {
    const hidePopover = vi.spyOn(HTMLElement.prototype, 'hidePopover');
    const start = stubViewTransitions();
    const { getByText, queryByRole } = render(
      <PopoverRoot defaultOpen viewTransition="vt-pop">
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPositioner>
          <PopoverPopup aria-label="Menu">
            <PopoverClose>Close</PopoverClose>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverRoot>
    );

    fireEvent.click(getByText('Close'));

    expect(start).toHaveBeenCalledTimes(1);
    // Name handed back to the trigger so the popup morphs into it.
    expect(nameOf(getByText('Open'))).toBe('vt-pop');
    // Hidden from the top layer immediately so the exit morph plays now.
    expect(hidePopover).toHaveBeenCalled();
    expect(queryByRole('dialog')).toBeNull();
  });

  it('still opens when View Transitions are unsupported (graceful fallback)', () => {
    // No stub installed: runViewTransition applies the change directly.
    const { getByText, queryByRole } = render(<Example viewTransition />);
    fireEvent.click(getByText('Open'));
    expect(queryByRole('dialog')).not.toBeNull();
  });

  it('does not touch view-transition-name when the mode is off', () => {
    const { getByText } = render(<Example />);
    expect(nameOf(getByText('Open'))).toBe('');
  });
});
