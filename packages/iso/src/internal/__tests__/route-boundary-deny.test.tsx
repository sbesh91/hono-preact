import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { runRequestScope } from '../../cache.js';
import { deny } from '../../outcomes.js';
import { env } from '../../is-browser.js';
import { markLoaderDeny } from '../loader-deny-mark.js';
import { takeServerDeny } from '../server-deny-registry.js';
import { RouteBoundary } from '../route-boundary.js';

// A child that throws on render.
function Thrower({ error }: { error: unknown }): never {
  throw error;
}

// These tests simulate the SSR string-render path, so `isBrowser()` must
// read false, matching how `render.tsx` sets `env.current = 'server'` for
// the real prerender.
let originalEnv: typeof env.current;
beforeEach(() => {
  originalEnv = env.current;
  env.current = 'server';
});
afterEach(() => {
  env.current = originalEnv;
});

describe('RouteBoundary server deny handling', () => {
  it('renders the fallback and records a tagged loader deny (server)', async () => {
    await runRequestScope(async () => {
      const html = renderToString(
        <RouteBoundary
          errorFallback={(e: Error) => <p class="fb">{e.message}</p>}
        >
          <Thrower error={markLoaderDeny(deny(404, 'gone'))} />
        </RouteBoundary>
      );
      expect(html).toContain('class="fb"');
      expect(html).toContain('gone');
      expect(takeServerDeny()).toEqual({ status: 404, headers: undefined });
    });
  });

  it('rethrows a tagged loader deny when there is no fallback', async () => {
    await runRequestScope(async () => {
      expect(() =>
        renderToString(
          <RouteBoundary>
            <Thrower error={markLoaderDeny(deny(403, 'no'))} />
          </RouteBoundary>
        )
      ).toThrow();
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('rethrows an UNTAGGED (middleware) deny even with a fallback', async () => {
    await runRequestScope(async () => {
      expect(() =>
        renderToString(
          <RouteBoundary errorFallback={<p>fb</p>}>
            <Thrower error={deny(403, 'mw')} />
          </RouteBoundary>
        )
      ).toThrow();
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('still renders the fallback for a plain Error', async () => {
    await runRequestScope(async () => {
      const html = renderToString(
        <RouteBoundary
          errorFallback={(e: Error) => <p class="fb">{e.message}</p>}
        >
          <Thrower error={new Error('boom')} />
        </RouteBoundary>
      );
      expect(html).toContain('boom');
      expect(takeServerDeny()).toBeNull();
    });
  });

  it('rethrows a plain Error when there is no fallback (server)', async () => {
    await runRequestScope(async () => {
      expect(() =>
        renderToString(
          <RouteBoundary>
            <Thrower error={new Error('boom')} />
          </RouteBoundary>
        )
      ).toThrow('boom');
      expect(takeServerDeny()).toBeNull();
    });
  });
});
