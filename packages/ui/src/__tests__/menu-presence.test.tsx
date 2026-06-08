// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Menu } from '../menu/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

function Setup() {
  return (
    <Menu.Root>
      <Menu.Trigger>open</Menu.Trigger>
      <Menu.Positioner>
        <Menu.Popup data-testid="menu">
          <Menu.Item>One</Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Root>
  );
}

describe('Menu exit animation', () => {
  it('keeps the popup mounted through the exit, then unmounts', async () => {
    const anim = makeAnimation();
    const restore = installGetAnimations([anim]);
    const { getByText, queryByTestId } = render(<Setup />);
    await act(async () => fireEvent.click(getByText('open')));
    expect(queryByTestId('menu')).not.toBeNull();

    await act(async () => fireEvent.click(getByText('open'))); // toggle closed
    expect(queryByTestId('menu')).not.toBeNull();
    expect(queryByTestId('menu')!.getAttribute('data-state')).toBe('closed');

    await act(async () => {
      anim.resolve();
    });
    expect(queryByTestId('menu')).toBeNull();
    restore();
  });
});
