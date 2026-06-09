// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Select } from '../select/index.js';
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
    <Select.Root>
      <Select.Trigger>
        <Select.Value placeholder="Pick" />
      </Select.Trigger>
      <Select.Positioner>
        <Select.Popup data-testid="lb">
          <Select.Option value="a">A</Select.Option>
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}

describe('Select exit animation', () => {
  it('keeps the listbox visible through the exit, then hides it', async () => {
    const anim = makeAnimation();
    restore = installGetAnimations([anim]);
    const { getByTestId, getByRole } = render(<Setup />);
    await act(async () => fireEvent.click(getByRole('combobox')));
    const lb = getByTestId('lb');
    // `hidden` is on the Positioner (parent); `data-state` is on the Popup (lb).
    const positioner = lb.parentElement!;
    expect(positioner.hidden).toBe(false);

    await act(async () => fireEvent.click(getByRole('combobox'))); // toggle closed
    // Still visible (animating), marked closed for the exit CSS.
    expect(positioner.hidden).toBe(false);
    expect(lb.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(positioner.hidden).toBe(true);
  });
});
