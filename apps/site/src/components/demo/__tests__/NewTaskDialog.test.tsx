// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import NewTaskDialog from '../NewTaskDialog.js';

describe('NewTaskDialog field errors', () => {
  it('associates the title error and shows the summary on invalid submit', async () => {
    render(<NewTaskDialog projectId="p-1" users={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    const form = document.querySelector('form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      const input = screen.getByLabelText(/title/i);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const description = input.getAttribute('aria-describedby');
      expect(description).toBeTruthy();
      expect(document.getElementById(description!)?.textContent).toMatch(
        /title is required/i
      );
      // The assignee combobox also carries a (visually hidden, always-mounted)
      // role="status" live region for its own result-count announcements, so
      // disambiguate by content rather than assuming a single status node.
      const summary = screen
        .getAllByRole('status')
        .find((el) => /field/i.test(el.textContent ?? ''));
      expect(summary?.textContent).toMatch(/1 field/i);
    });
  });
});
