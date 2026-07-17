// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { useTitle } from 'hono-preact';
import DemoLayout from '../demo-layout.js';

function Page() {
  useTitle('Some Page');
  return <p>content</p>;
}

// hoofd's title/meta writes are debounced (a single rAF-ish setTimeout
// batches the whole render), and its link writes clean themselves up on
// unmount, so each test gets a fresh head via testing-library's auto
// `afterEach(cleanup)`. Assertions still poll with `waitFor` to ride out
// that debounce rather than race it.
afterEach(() => cleanup());

function renderLayout(path: string) {
  history.replaceState(null, '', path);
  return render(
    <LocationProvider>
      <DemoLayout>
        <Page />
      </DemoLayout>
    </LocationProvider>
  );
}

describe('demo layout head wiring', () => {
  it('applies the %s title template to child titles', async () => {
    renderLayout('/demo/projects/inf');
    await waitFor(() =>
      expect(document.title).toBe('Some Page · hono-preact demo')
    );
  });

  it('composes the canonical link from the real current path, with no undefined leakage', async () => {
    renderLayout('/demo/projects/inf');
    await waitFor(() => {
      const canonical = document.querySelector('link[rel="canonical"]');
      expect(canonical).not.toBeNull();
      const href = canonical?.getAttribute('href') ?? '';
      expect(href).toBe('https://framework.sbesh.com/demo/projects/inf');
      expect(href).not.toContain('undefined');
    });
  });

  it('wires the shared og/description/request-id meta tags', async () => {
    renderLayout('/demo/projects/inf');
    await waitFor(() => {
      const siteName = document.querySelector('meta[property="og:site_name"]');
      expect(siteName?.getAttribute('content')).toBe('hono-preact demo');

      const description = document.querySelector('meta[name="description"]');
      expect(description?.getAttribute('content')).toBe(
        'Interactive feature demo for the hono-preact framework.'
      );

      // No SSR HonoContext in this harness, so useHonoContext() falls back
      // to the client default: the request id reads as the 'local' fallback.
      const requestId = document.querySelector('meta[name="demo-request-id"]');
      expect(requestId?.getAttribute('content')).toBe('local');
    });
  });
});
