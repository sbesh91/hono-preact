import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStringAsync } from 'preact-render-to-string';
import { runRequestScope } from '../../cache.js';
import { deny } from '../../outcomes.js';
import { takeServerDeny } from '../server-deny-registry.js';
import { defineLoader } from '../../define-loader.js';
import { env } from '../../is-browser.js';

// A loader that always denies. `.View` is a FACTORY: call it with the render
// fn (and optional `{ errorFallback }`) to get a component, then render that
// component. `<ref.View ...>` as JSX is not the real API (loader-view.test.tsx
// is the reference for the call shape).
const denyingLoader = defineLoader(async () => {
  throw deny(404, "No project named 'nope'.");
});

let originalEnv: typeof env.current;
beforeEach(() => {
  originalEnv = env.current;
  env.current = 'server';
});
afterEach(() => {
  env.current = originalEnv;
});

describe('DataReader loader-local deny (server)', () => {
  it('renders the local errorFallback and records the deny', async () => {
    await runRequestScope(async () => {
      const View = denyingLoader.View(() => <div>never</div>, {
        errorFallback: (e: Error) => (
          <div class="panel">Board error: {e.message}</div>
        ),
      });
      const html = await renderToStringAsync(<View />);
      expect(html).toContain('class="panel"');
      expect(html).toContain("No project named 'nope'.");
      // Baked for hydration:
      expect(html).toContain('data-loader-deny="');
      // Response facts recorded:
      expect(takeServerDeny()).toEqual({ status: 404, headers: undefined });
    });
  });

  it('rethrows (tagged) when there is no local errorFallback', async () => {
    await runRequestScope(async () => {
      const View = denyingLoader.View(() => <div>never</div>);
      await expect(renderToStringAsync(<View />)).rejects.toBeTruthy();
      // Not recorded by the loader itself; an outer boundary/renderPage handles it.
      expect(takeServerDeny()).toBeNull();
    });
  });
});
