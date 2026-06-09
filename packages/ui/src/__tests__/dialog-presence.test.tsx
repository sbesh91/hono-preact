// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Dialog } from '../dialog/index.js';
import { makeAnimation, installGetAnimations } from './presence-helpers.js';

// Fake timers so usePresence's internal safety-cap timer (a real setTimeout)
// cannot fire mid-test under CPU contention and prematurely finalize the exit;
// the exit is driven deterministically by resolving the fake animation instead.
// restore is held here and undone in afterEach so a failing assertion can never
// leak the global getAnimations patch into a later test.
let restore: (() => void) | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  restore?.();
  restore = undefined;
  vi.useRealTimers();
});

function Setup() {
  return (
    <Dialog.Root>
      <Dialog.Trigger>open</Dialog.Trigger>
      <Dialog.Popup data-testid="dlg">
        <Dialog.Title>Title</Dialog.Title>
        <Dialog.Close>close</Dialog.Close>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

describe('Dialog exit animation', () => {
  it('defers close() until the exit animation resolves', async () => {
    const anim = makeAnimation();
    restore = installGetAnimations([anim]);
    const { getByText, getByTestId } = render(<Setup />);
    await act(async () => fireEvent.click(getByText('open')));
    const dlg = getByTestId('dlg') as HTMLDialogElement;
    expect(dlg.open).toBe(true);

    await act(async () => fireEvent.click(getByText('close')));
    // Still open (deferred), marked closed for the exit CSS.
    expect(dlg.open).toBe(true);
    expect(dlg.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(dlg.open).toBe(false);
  });
});
