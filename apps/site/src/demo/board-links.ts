// Hrefs for the board's two independent query knobs (?priority= filter,
// ?insights= mode). Each control changes its own key and preserves the
// other's current value, so filtering and deep analysis compose.
export function boardHref(
  slug: string,
  opts: { priority?: string; insights?: string }
): string {
  const qs = new URLSearchParams();
  if (opts.priority && opts.priority !== 'all')
    qs.set('priority', opts.priority);
  if (opts.insights && opts.insights !== 'quick')
    qs.set('insights', opts.insights);
  const s = qs.toString();
  return s ? `/demo/projects/${slug}?${s}` : `/demo/projects/${slug}`;
}
