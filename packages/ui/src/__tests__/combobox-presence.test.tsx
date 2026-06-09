// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Combobox } from '../combobox/index.js';
import { makeAnimation, installGetAnimations } from './presence-helpers.js';

afterEach(cleanup);

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
    const restore = installGetAnimations([anim]);
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
    restore();
  });
});
