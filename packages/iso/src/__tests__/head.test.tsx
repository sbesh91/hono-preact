// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { Head } from '../head.js';

afterEach(() => cleanup());

describe('Head', () => {
  it('renders <head> with charset and viewport defaults', () => {
    const { container } = render(<Head />);
    const head = container.querySelector('head');
    expect(head).not.toBeNull();
    expect(head?.querySelector('meta[charset="utf-8"]')).not.toBeNull();
    expect(
      head?.querySelector('meta[name="viewport"][content="width=device-width,initial-scale=1.0"]')
    ).not.toBeNull();
  });

  it('renders an empty <title> when defaultTitle is omitted', () => {
    const { container } = render(<Head />);
    const title = container.querySelector('head > title');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('');
  });

  it('renders defaultTitle inside <title>', () => {
    const { container } = render(<Head defaultTitle="hono-preact" />);
    const title = container.querySelector('head > title');
    expect(title?.textContent).toBe('hono-preact');
  });

  it('emits children inside <head>', () => {
    const { container } = render(
      <Head defaultTitle="x">
        <link rel="stylesheet" href="/styles.css" />
        <meta name="theme-color" content="#000" />
      </Head>
    );
    const head = container.querySelector('head');
    expect(head?.querySelector('link[rel="stylesheet"][href="/styles.css"]')).not.toBeNull();
    expect(head?.querySelector('meta[name="theme-color"][content="#000"]')).not.toBeNull();
  });
});
