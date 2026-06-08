// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Popover } from '../popover/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

function Setup() {
  return (
    <Popover.Root>
      <Popover.Trigger>open</Popover.Trigger>
      <Popover.Positioner>
        <Popover.Popup data-testid="pop">hi</Popover.Popup>
      </Popover.Positioner>
    </Popover.Root>
  );
}

describe('Popover exit animation', () => {
  it('keeps the popup mounted through the exit, then unmounts', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { getByText, queryByTestId } = render(<Setup />);
    await act(async () => fireEvent.click(getByText('open')));
    expect(queryByTestId('pop')).not.toBeNull();

    await act(async () => fireEvent.click(getByText('open'))); // toggle closed
    // Still mounted, marked closed for the exit CSS.
    expect(queryByTestId('pop')).not.toBeNull();
    expect(queryByTestId('pop')!.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(queryByTestId('pop')).toBeNull();
    restore();
  });
});
