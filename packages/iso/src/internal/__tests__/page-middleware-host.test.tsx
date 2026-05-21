// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  render as rtlRender,
  screen,
  cleanup,
  waitFor,
} from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineClientMiddleware } from '../../define-middleware.js';
import { PageMiddlewareHost } from '../page-middleware-host.js';
import { render as renderOutcome } from '../../page-only.js';

afterEach(() => cleanup());

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
  route: () => {},
} as never;

describe('PageMiddlewareHost', () => {
  it('renders children when no middleware short-circuits (client)', async () => {
    const mw = defineClientMiddleware(async (_c, next) => {
      await next();
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.queryByText('page-content')).not.toBeNull()
    );
  });

  it('renders the alternative component on render() outcome', async () => {
    const Alt = () => <div>alternative</div>;
    const mw = defineClientMiddleware(async () => {
      throw renderOutcome(Alt);
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.queryByText('alternative')).not.toBeNull()
    );
    expect(screen.queryByText('page-content')).toBeNull();
  });

  it('renders nothing while the chain is pending then renders children once resolved', async () => {
    let resolve!: () => void;
    const mw = defineClientMiddleware(async (_c, next) => {
      await new Promise<void>((r) => {
        resolve = r;
      });
      await next();
    });
    rtlRender(
      <LocationProvider>
        <PageMiddlewareHost use={[mw]} location={loc}>
          <div>page-content</div>
        </PageMiddlewareHost>
      </LocationProvider>
    );
    expect(screen.queryByText('page-content')).toBeNull();
    resolve();
    await waitFor(() =>
      expect(screen.queryByText('page-content')).not.toBeNull()
    );
  });
});
