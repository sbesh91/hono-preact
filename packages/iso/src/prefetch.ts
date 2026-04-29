import { type RouteHook } from 'preact-iso';
import { type LoaderCache } from './cache.js';
import { isBrowser } from './is-browser.js';
import { type Loader } from './loader.js';

export async function prefetch<T>(
  loader: Loader<T>,
  cache?: LoaderCache<T>,
  location?: RouteHook
): Promise<T> {
  const fakeLocation =
    location ??
    ({
      path: '',
      url: '',
      query: {},
      params: {},
      pathParams: {},
      route: () => {},
    } as unknown as RouteHook);
  const result = await loader({ location: fakeLocation });
  if (isBrowser()) cache?.set(result);
  return result;
}
