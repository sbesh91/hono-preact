# Spec E: Speculation Rules emitter

Part of the [web standards adoption roadmap](./2026-05-23-web-standards-adoption-roadmap.md).

## Summary

The server emits one `<script type="speculationrules">` tag in `<head>` that instructs supporting browsers to prefetch same-origin `<a href>` links on moderate eagerness. App authors get two interactions:

1. App-level off switch via `defineApp({ speculation: false })`.
2. Per-link off switch via the HTML attribute `data-no-prefetch`.

No mode/eagerness knobs in v1. Defaults are baked: `prefetch`, `eagerness: "moderate"`, same-origin scope, `data-no-prefetch` exclusion. The type can widen from `boolean` to `boolean | SpeculationConfig` later without breaking existing code if a real configuration request appears.

## Goals

- Faster perceived navigation on Chromium browsers, zero config required.
- Surface area limited to one boolean and one HTML attribute. Anyone reading an app's source can understand the whole feature in 30 seconds.
- Cheap to ship and cheap to roll back: one server-side string emission, one head injection seam already in use.

## Non-goals

- Per-route prefetch flags or path exclusion lists.
- Programmatic API for app code to add or modify rules at runtime.
- Prerender mode (full background render). Prefetch only.
- CSP nonce plumbing. The framework has no nonce infrastructure today; documented as a known limitation for apps with strict CSP, not solved here.
- A polyfill or fallback for browsers without Speculation Rules support. The tag is silently ignored where unsupported; no behavior change there.

## Architecture overview

One pure function builds the JSON; one call site in `render.tsx` includes the resulting `<script>` in `headTags`. Behavior is server-side only. Nothing changes on the client.

When `speculation: false` is passed to `defineApp`, the function returns the empty string and the head injection is a no-op. When omitted or `true`, the static script is included.

## Detailed design

### Public API

Extend `AppConfig` in `packages/iso/src/define-app.ts`:

```ts
export type AppConfig = {
  use?: ReadonlyArray<AppUseElement>;
  speculation?: boolean;
};
```

`speculation` defaults to `true` when omitted.

### Per-link opt-out

The rendered selector exclusion uses the HTML attribute `data-no-prefetch`. App authors apply it directly to `<a>` elements; no framework component or prop is involved.

```tsx
<a href="/logout" data-no-prefetch>Sign out</a>
```

This is consistent with the `selector_matches` clause in the emitted rule.

### Emitted tag

Static JSON (no per-response variation):

```html
<script type="speculationrules">
{
  "prefetch": [{
    "where": {
      "and": [
        { "href_matches": "/*" },
        { "not": { "selector_matches": "[data-no-prefetch]" } }
      ]
    },
    "eagerness": "moderate"
  }]
}
</script>
```

`href_matches: "/*"` restricts matching to same-origin paths. `selector_matches: "[data-no-prefetch]"` excludes explicitly opted-out links. `eagerness: "moderate"` triggers prefetch on hover or touchstart, well before the click.

### Implementation site

A new module `packages/server/src/speculation-rules.ts` exports the constant tag string (and the empty string for `speculation: false`):

```ts
const SPECULATION_RULES_TAG = `<script type="speculationrules">${SPECULATION_RULES_JSON}</script>`;

export function speculationRulesTag(config: AppConfig): string {
  return config.speculation === false ? '' : SPECULATION_RULES_TAG;
}
```

The render pipeline already builds `headTags` at `packages/server/src/render.tsx:226`. `speculationRulesTag(appConfig)` joins that array alongside the existing `<title>`, `<meta>`, and `<link>` entries. Injection lands via the existing `html.replace('</head>', …)` swap at line 234.

`appConfig` is already threaded into the render function (it carries `use` for middleware); no new plumbing is required.

### Wire format

One line of JSON-in-`<script>`. The JSON is pre-built at module load time (it has no inputs to vary on), so each response adds a constant string concat. Byte cost is roughly 220 bytes of HTML.

## Testing strategy

- **Unit:** `speculationRulesTag({ speculation: false })` returns `''`; `speculationRulesTag({})` and `speculationRulesTag({ speculation: true })` return the same non-empty tag. Snapshot the non-empty output exactly once.
- **Integration:** SSR a page with two `<a>` links (one with `data-no-prefetch`); assert the `<script type="speculationrules">` is present once in `<head>` and the JSON parses as expected. Repeat with `defineApp({ speculation: false })`; assert the tag is absent.
- **No browser-side prefetch behavior test.** That is the browser's contract; we test only the framework's emission.
- **Verification before completion.** Full test suite passes on Node and workerd via the existing matrix.

## Delivery

Single PR (no version bump). Touches:

- `packages/iso/src/define-app.ts`: add `speculation?: boolean` to `AppConfig`.
- `packages/server/src/speculation-rules.ts`: new module exporting `speculationRulesTag(config)`.
- `packages/server/src/render.tsx`: call `speculationRulesTag(appConfig)` inside the `headTags` build and let it join the existing list.
- `apps/site`: one docs page under SSR describing the default behavior, the `data-no-prefetch` opt-out, and the `defineApp({ speculation: false })` off switch. Per the project convention, no migration breadcrumbs; describe what is.

Sits on `main` with A and C. `v0.3.0` cuts once D also lands (Spec B is deferred pending upstream Navigation API support in `preact-iso`).

## Risk register

- **Per-response cost.** A constant ~220 bytes added to every SSR response. Acceptable. Apps that find it material disable the feature.
- **Accidental prefetch of side-effecting GETs.** Logout, download links, ephemeral-token URLs. Mitigation: `data-no-prefetch` is documented with these as the canonical examples.
- **CSP without `script-src 'self'` or nonce.** Strict-CSP apps will see the speculation script blocked. Mitigation: documented as a known limitation. If demand appears, a follow-up adds nonce plumbing across the framework's head emission.
- **Browser feature regression.** Speculation Rules is a Chromium feature; Safari and Firefox ignore unknown `<script type>` values. Risk surface is whatever future browsers might do with the tag; today's behavior is "ignore." No mitigation needed.
