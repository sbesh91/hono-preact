// hono-preact/page -- page-scope outcome kitchen sink (umbrella re-export).
//
// Forwards to @hono-preact/iso/page so consumers using the published
// umbrella can write `import { redirect, deny, render } from 'hono-preact/page'`
// exactly as the docs show. The iso subpath is where the constructors and
// predicates actually live; this file exists so the umbrella's exports map
// matches the consolidated subpath after `scripts/consolidate.mjs` runs.
export * from '@hono-preact/iso/page';
