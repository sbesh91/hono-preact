// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { ClientScript } from '../client-script.js';

afterEach(cleanup);

describe('ClientScript', () => {
  it('renders a module script tag', () => {
    const { container } = render(<ClientScript />);
    const script = container.querySelector('script[type="module"]');
    expect(script).not.toBeNull();
  });

  it('renders a script with a src attribute', () => {
    const { container } = render(<ClientScript />);
    const script = container.querySelector('script[type="module"]') as HTMLScriptElement;
    expect(script.getAttribute('src')).toBeTruthy();
  });

  it('points at the dev virtual-module URL when not prod', () => {
    // Vite statically replaces `import.meta.env.PROD` at transform time, so under
    // vitest (where PROD is false) the implementation always renders the dev URL.
    // This validates the dev branch; the prod branch is exercised by an actual
    // production build (the static replacement collapses to the prod string).
    const { container } = render(<ClientScript />);
    const script = container.querySelector('script[type="module"]') as HTMLScriptElement;
    expect(script.getAttribute('src')).toBe('/@id/__x00__virtual:hono-preact/client');
  });

  it('renders the module script with `async` so streaming SSR does not defer hydration', () => {
    // Without `async`, a module script waits for the document to finish parsing
    // before executing. For streaming SSR responses (kept open while loader
    // chunks flush as inline script tags), that means hydration waits for the
    // whole stream, every chunk queues, and the post-hydration drain collapses
    // them all into one render at the final value. `async` makes the client
    // entry run as soon as it's downloaded, so subscriptions land before the
    // bulk of the chunks arrive.
    const { container } = render(<ClientScript />);
    const script = container.querySelector('script[type="module"]') as HTMLScriptElement;
    expect(script.hasAttribute('async')).toBe(true);
  });
});
