// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { useTitle } from 'hono-preact';
import DemoLayout from '../demo-layout.js';

function Page() {
  useTitle('Some Page');
  return <p>content</p>;
}

describe('demo layout head wiring', () => {
  it('applies the %s title template to child titles', async () => {
    render(
      <DemoLayout>
        <Page />
      </DemoLayout>
    );
    await waitFor(() =>
      expect(document.title).toBe('Some Page · hono-preact demo')
    );
  });
});
