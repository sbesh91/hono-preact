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

describe('CommandPalette', () => {
  it('opens on Cmd+K and shows the search input', async () => {
    const { getByLabelText } = setup();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() =>
      expect(getByLabelText('Search documentation')).toBeTruthy()
    );
  });

  it('opens from the trigger button and filters by query', async () => {
    const { getByRole, getByLabelText, findByText } = setup();
    fireEvent.click(getByRole('button', { name: /search/i }));
    const input = getByLabelText('Search documentation') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'stream' } });
    expect(await findByText('Streaming')).toBeTruthy();
  });
});
