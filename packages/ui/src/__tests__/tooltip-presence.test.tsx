// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Tooltip } from '../tooltip/index.js';
import { makeAnimation, installGetAnimations } from './presence-helpers.js';

afterEach(cleanup);

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
    const restore = installGetAnimations([anim]);
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
    restore();
  });
});
