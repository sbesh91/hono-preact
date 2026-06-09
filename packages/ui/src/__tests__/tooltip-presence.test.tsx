// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Tooltip } from '../tooltip/index.js';
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
    <Tooltip.Root>
      <Tooltip.Trigger>hover</Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Popup data-testid="tip">hi</Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

describe('Tooltip exit animation', () => {
  it('keeps the popup mounted through the exit, then unmounts', async () => {
    const anim = makeAnimation();
    restore = installGetAnimations([anim]);
    const { getByText, queryByTestId } = render(<Setup />);
    await act(async () => fireEvent.focus(getByText('hover')));
    expect(queryByTestId('tip')).not.toBeNull();

    await act(async () => fireEvent.blur(getByText('hover')));
    expect(queryByTestId('tip')).not.toBeNull();
    expect(queryByTestId('tip')!.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(queryByTestId('tip')).toBeNull();
  });
});
