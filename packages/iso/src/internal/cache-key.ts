import type { RouteHook } from 'preact-iso';

export function serializeLocationForCache(
  loc: RouteHook,
  cacheKeyParams: string[] | '*'
): string {
  const sp = (loc.searchParams ?? {}) as Record<string, string>;
  const keys =
    cacheKeyParams === '*'
      ? Object.keys(sp).sort()
      : cacheKeyParams.filter((k) => k in sp).sort();
  const sortedSearch = keys.map((k) => `${k}=${sp[k]}`).join('&');
  return `${loc.path}?${sortedSearch}`;
}
