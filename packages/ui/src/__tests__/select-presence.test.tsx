// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Select } from '../select/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

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
    const restore = installGetAnimations([anim]);
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
    restore();
  });
});
