// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { useContext } from 'preact/hooks';
import { render } from '@testing-library/preact';
import {
  RouteLocationsContext,
  RouteLocationsProvider,
} from '../internal/route-locations.js';

describe('RouteLocationsProvider', () => {
  it('exposes the moduleKey -> location map to descendants', () => {
    const inner = { path: '/movies/123', pathParams: { id: '123' }, searchParams: {} };
    let observed: any = null;

    const Probe = () => {
      observed = useContext(RouteLocationsContext);
      return null;
    };

    render(
      h(
        RouteLocationsProvider,
        { moduleKey: 'pages/movie', location: inner as any },
        h(Probe, null)
      )
    );

    expect(observed).toBeInstanceOf(Map);
    expect(observed.get('pages/movie')).toEqual(inner);
  });

  it('extends a parent map without mutating it', () => {
    const outer = { path: '/movies', pathParams: {}, searchParams: {} };
    const inner = { path: '/movies/123', pathParams: { id: '123' }, searchParams: {} };
    let observed: any = null;

    const Probe = () => {
      observed = useContext(RouteLocationsContext);
      return null;
    };

    render(
      h(
        RouteLocationsProvider,
        { moduleKey: 'pages/movies-layout', location: outer as any },
        h(
          RouteLocationsProvider,
          { moduleKey: 'pages/movie', location: inner as any },
          h(Probe, null)
        )
      )
    );

    expect(observed.get('pages/movies-layout')).toEqual(outer);
    expect(observed.get('pages/movie')).toEqual(inner);
  });
});
