// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/preact';
import { CopyButton } from '../CopyButton.js';

afterEach(cleanup);

describe('CopyButton', () => {
  it('copies the text and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const { getByRole } = render(<CopyButton text="hello world" />);
    const btn = getByRole('button');
    expect(btn.textContent).toBe('Copy');

    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith('hello world');
    await waitFor(() => expect(btn.textContent).toBe('Copied'));
  });
});
