// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { PageHost } from '../page-host.js';
import { setLatestFragment, clearLatestFragment } from '../navigator.js';

afterEach(cleanup);

const loc = { path: '/docs/x', url: '/docs/x', searchParams: {}, pathParams: { slug: 'x' } } as RouteHook;

describe('PageHost (pre-island)', () => {
  it('renders the user component with location prop', () => {
    function User(props: RouteHook) {
      return <p data-testid="page">slug={props.pathParams!.slug}</p>;
    }
    render(
      <LocationProvider>
        <PageHost component={User} location={loc} path="/docs/:slug" />
      </LocationProvider>
    );
    expect(screen.getByTestId('page')).toHaveTextContent('slug=x');
  });
});

describe('PageHost (island mode)', () => {
  beforeEach(() => clearLatestFragment());

  it('splices fragment HTML and hydrates the user component into the host div', async () => {
    function User(props: RouteHook) {
      return <p data-testid="island">island slug={props.pathParams!.slug}</p>;
    }
    const { container } = render(
      <LocationProvider>
        <PageHost component={User} location={loc} path="/docs/:slug" />
      </LocationProvider>
    );
    // Server-rendered fragment: a <p> with the same shape as User would
    // produce, so hydrate matches.
    setLatestFragment('/docs/:slug', '<p data-testid="island">island slug=x</p>');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('island')).toHaveTextContent('island slug=x');
    // The host div is the only child rendered by the outer tree; the <p> is
    // inside it as a hydrated island.
    const host = container.querySelector('[data-hp-island="true"]');
    expect(host).not.toBeNull();
    expect(host!.querySelector('p')).not.toBeNull();
  });
});
