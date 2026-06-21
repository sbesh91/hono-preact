// Browser-safe shapes and lookup for the docs heading index. Kept separate from
// generate-docs-index.ts (which imports node:fs and github-slugger) so client and
// SSR code can consume the index without pulling those node-only deps into the
// browser or worker bundle.
export type DocHeading = { text: string; id: string; depth: 2 | 3 };
export type DocPage = { title: string; route: string; headings: DocHeading[] };

/** The headings for the page at `route`, or `[]` if none. */
export function headingsForRoute(
  pages: DocPage[],
  route: string
): DocHeading[] {
  return pages.find((p) => p.route === route)?.headings ?? [];
}
