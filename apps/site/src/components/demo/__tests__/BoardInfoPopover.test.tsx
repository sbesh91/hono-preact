// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { BoardInfoPopover } from '../BoardInfoPopover.js';

describe('BoardInfoPopover', () => {
  it('opens a dialog with the explainer and closes on Escape', async () => {
    render(<BoardInfoPopover />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /about this board/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/what this board exercises/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
