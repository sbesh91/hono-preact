// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Combobox } from '../combobox/index.js';
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
    <Combobox.Root>
      <Combobox.Input data-testid="input" />
      <Combobox.Positioner>
        <Combobox.Popup data-testid="lb">
          <Combobox.Option value="a">A</Combobox.Option>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

describe('Combobox exit animation', () => {
  it('keeps the listbox visible through the exit, then hides it', async () => {
    const anim = makeAnimation();
    restore = installGetAnimations([anim]);
    const { getByTestId } = render(<Setup />);
    // Focus opens the listbox (openOnFocus default).
    await act(async () => fireEvent.focus(getByTestId('input')));
    const lb = getByTestId('lb');
    // `hidden` is on the Positioner (parent); `data-state` is on the Popup (lb).
    const positioner = lb.parentElement!;
    expect(positioner.hidden).toBe(false);

    // Single Escape closes without reverting (Model A two-stage).
    await act(async () =>
      fireEvent.keyDown(getByTestId('input'), { key: 'Escape' })
    );
    // Still visible (animating out), marked closed for exit CSS.
    expect(positioner.hidden).toBe(false);
    expect(lb.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(positioner.hidden).toBe(true);
  });
});
