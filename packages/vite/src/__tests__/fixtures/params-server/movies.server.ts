import { defineLoader, serverRoute } from '@hono-preact/iso';

// `params` (the search-param cache-key dependency list) is route-bound only:
// a bare `defineLoader` ctx has no `location`, so there is nothing for it to
// vary on, and `StandaloneOpts` omits the field. The loaders that declare
// `params` therefore come from `serverRoute(r).loader`, which is what a real
// app writes. `default` stays a bare `defineLoader` so this fixture also covers
// the route-independent, param-less case that produces no meta entry at all.
const route = serverRoute('/movies/:id');

const summaryFn = async () => ({ title: 'Movie' });
const castFn = async () => ({ actors: [] });
const defaultFn = async () => ({ data: null });

export const serverLoaders = {
  summary: route.loader(summaryFn, { params: ['genre'] }),
  cast: route.loader(castFn, { params: '*' }),
  default: defineLoader(defaultFn),
};
