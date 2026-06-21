// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { CommandPalette } from '../CommandPalette.js';
import type { DocPage } from '../../llms/generate-docs-index.js';

afterEach(cleanup);

const pages: DocPage[] = [
  {
    title: 'Server Loaders',
    route: '/docs/loaders',
    headings: [{ text: 'Options', id: 'options', depth: 2 }],
  },
  { title: 'Streaming', route: '/docs/streaming', headings: [] },
];

function setup() {
  return render(
    <LocationProvider>
      <CommandPalette pages={pages} />
    </LocationProvider>
  );
}

// The Dialog keeps its <dialog> (and content) mounted when closed and toggles
// visibility via the `data-state` attribute, so open/closed is asserted on
// data-state rather than on the input's presence in the DOM.
const dialogState = () =>
  document.querySelector('dialog')?.getAttribute('data-state');

describe('CommandPalette', () => {
  it('opens on Cmd+K', async () => {
    setup();
    expect(dialogState()).toBe('closed');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() => expect(dialogState()).toBe('open'));
  });

  it('opens from the trigger button and filters by query', async () => {
    const { getByRole, getByLabelText, findByText } = setup();
    fireEvent.click(getByRole('button', { name: /search/i }));
    const input = getByLabelText('Search documentation') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'stream' } });
    expect(await findByText('Streaming')).toBeTruthy();
  });

  it('closes the whole palette on a single Escape', async () => {
    const { getByLabelText } = setup();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() => expect(dialogState()).toBe('open'));
    fireEvent.keyDown(getByLabelText('Search documentation'), {
      key: 'Escape',
    });
    await waitFor(() => expect(dialogState()).toBe('closed'));
  });

  it('navigates and closes when a result row is clicked (mouse path)', async () => {
    const { getByRole, getByText } = setup();
    fireEvent.click(getByRole('button', { name: /search/i }));
    await waitFor(() => expect(dialogState()).toBe('open'));
    // Empty query lists every page; click one with the mouse.
    fireEvent.click(getByText('Server Loaders'));
    await waitFor(() => expect(dialogState()).toBe('closed'));
  });

  it('does not let list-typeahead capture printable keys from the input', async () => {
    const { getByLabelText } = setup();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await waitFor(() => getByLabelText('Search documentation'));
    // 's' matches the list rows ("Server Loaders"/"Streaming"); with
    // list-typeahead enabled the nav handler would preventDefault it and steal
    // the keystroke from the input. fireEvent returns false if defaultPrevented.
    const notPrevented = fireEvent.keyDown(input, { key: 's' });
    expect(notPrevented).toBe(true);
  });

  it('moves the highlight with ArrowDown and selects it with Enter', async () => {
    const { getByLabelText, getByText } = setup();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await waitFor(() => getByLabelText('Search documentation'));
    // Empty query lists [Server Loaders, Streaming]; the first is active.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const streamingOption = getByText('Streaming').closest('[role="option"]')!;
    await waitFor(() =>
      expect(streamingOption.getAttribute('aria-selected')).toBe('true')
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(dialogState()).toBe('closed'));
  });

  it('shows the empty state for a query with no matches', async () => {
    const { getByRole, getByLabelText, findByText } = setup();
    fireEvent.click(getByRole('button', { name: /search/i }));
    const input = getByLabelText('Search documentation') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'zzzzz' } });
    expect(await findByText('No results')).toBeTruthy();
    expect(dialogState()).toBe('open');
  });
});
