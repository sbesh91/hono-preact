// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Dialog } from '../dialog/index.js';
import {
  makeAnimation,
  installGetAnimations,
} from './presence-helpers.js';

afterEach(cleanup);

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
    const restore = installGetAnimations([anim]);
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
    restore();
  });
});
