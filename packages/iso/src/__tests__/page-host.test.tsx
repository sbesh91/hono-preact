// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { PageHost } from '../page-host.js';

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
