import type { RouteHook } from 'preact-iso';

export function serializeLocationForCache(
  loc: RouteHook,
  params: string[] | '*'
): string {
  const sp = (loc.searchParams ?? {}) as Record<string, string>;
  const keys =
    params === '*'
      ? Object.keys(sp).sort()
      : params.filter((k) => k in sp).sort();
  const sortedSearch = keys.map((k) => `${k}=${sp[k]}`).join('&');
  return `${loc.path}?${sortedSearch}`;
}
