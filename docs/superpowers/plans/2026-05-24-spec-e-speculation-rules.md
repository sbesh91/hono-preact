# Spec E (Speculation Rules) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Speculation Rules emitter that injects a single `<script type="speculationrules">` tag into `<head>` when an app sets `defineApp({ speculation: true })`. Apps opt individual links out with `data-no-prefetch`.

**Architecture:** A pure function `speculationRulesTag(config)` returns the constant tag string when `config.speculation === true`, otherwise the empty string. The render path in `packages/server/src/render.tsx` calls it and joins the result with the existing `headTags` array, landing in `<head>` via the same `html.replace('</head>', …)` swap that already handles `<title>`, `<meta>`, and `<link>` injection. No client-side code; no runtime variation in the JSON payload.

**Tech Stack:** TypeScript, Preact, Vitest, hono. Existing project uses `pnpm` workspaces and `vitest run` from the repo root.

**Spec:** `docs/superpowers/specs/2026-05-24-spec-e-speculation-rules-design.md`

---

## File Structure

- **Modify** `packages/iso/src/define-app.ts`: add `speculation?: boolean` field to `AppConfig`.
- **Create** `packages/server/src/speculation-rules.ts`: pure function module, ~15 lines. Exports `speculationRulesTag(config: AppConfig): string` plus the constant tag string (named export so tests can compare directly).
- **Create** `packages/server/src/__tests__/speculation-rules.test.ts`: unit tests for the pure function.
- **Modify** `packages/server/src/render.tsx`: import `speculationRulesTag`, call it inside the `headTags` array build at line 226-232, pass `options?.appConfig` (or `{}` when absent).
- **Create** `packages/server/src/__tests__/render-speculation.test.tsx`: integration tests covering opt-in and default-off behavior through `renderPage`.
- **Create** `apps/site/src/pages/docs/link-prefetch.mdx`: documentation page.
- **Modify** `apps/site/src/pages/docs/nav.ts`: add the new docs page to the Infrastructure section.

---

## Task 1: Add `speculation` field to `AppConfig`

The `AppConfig` type lives in `@hono-preact/iso`. We add the field first so the test in Task 2 (which references `AppConfig`) compiles cleanly. The field is type-only and has no runtime effect on its own.

**Files:**
- Modify: `packages/iso/src/define-app.ts`

- [ ] **Step 1: Add the field**

In `packages/iso/src/define-app.ts`, find the `AppConfig` type (lines 19-21):

```ts
export type AppConfig = {
  use?: ReadonlyArray<AppUseElement>;
};
```

Replace with:

```ts
export type AppConfig = {
  use?: ReadonlyArray<AppUseElement>;
  /**
   * When `true`, the server emits a `<script type="speculationrules">` tag
   * into `<head>` that instructs supporting browsers to prefetch same-origin
   * `<a href>` links on moderate eagerness. Defaults to `false`. Individual
   * links opt out with `data-no-prefetch`.
   */
  speculation?: boolean;
};
```

- [ ] **Step 2: Verify type compiles**

Run: `pnpm typecheck`

Expected: clean. (`pnpm typecheck` runs `pnpm -r exec tsc --noEmit` across the workspace.)

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/define-app.ts
git commit -m "feat(iso): add speculation field to AppConfig

Opt-in toggle for Spec E (Speculation Rules emitter). Type-only change;
no runtime effect until the server module reads it in a follow-up task."
```

---

## Task 2: Write the `speculationRulesTag` pure module (TDD)

The module is small enough that one focused unit test file covers it. We TDD: failing test first, then the minimal module, then verify pass.

**Files:**
- Create: `packages/server/src/speculation-rules.ts`
- Create: `packages/server/src/__tests__/speculation-rules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/speculation-rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { speculationRulesTag, SPECULATION_RULES_TAG } from '../speculation-rules.js';

describe('speculationRulesTag', () => {
  it('returns the empty string when speculation is omitted', () => {
    expect(speculationRulesTag({})).toBe('');
  });

  it('returns the empty string when speculation is false', () => {
    expect(speculationRulesTag({ speculation: false })).toBe('');
  });

  it('returns the tag when speculation is true', () => {
    expect(speculationRulesTag({ speculation: true })).toBe(SPECULATION_RULES_TAG);
  });

  it('emitted tag is byte-stable', () => {
    expect(SPECULATION_RULES_TAG).toBe(
      '<script type="speculationrules">' +
        '{"prefetch":[{"where":{"and":[' +
        '{"href_matches":"/*"},' +
        '{"not":{"selector_matches":"[data-no-prefetch]"}}' +
        ']},"eagerness":"moderate"}]}' +
        '</script>'
    );
  });

  it('emitted JSON is parseable and well-formed', () => {
    const match = SPECULATION_RULES_TAG.match(
      /^<script type="speculationrules">(.*)<\/script>$/
    );
    expect(match).not.toBeNull();
    const json = JSON.parse(match![1]);
    expect(json).toEqual({
      prefetch: [
        {
          where: {
            and: [
              { href_matches: '/*' },
              { not: { selector_matches: '[data-no-prefetch]' } },
            ],
          },
          eagerness: 'moderate',
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/server/src/__tests__/speculation-rules.test.ts`

Expected: FAIL with module-not-found error (`Cannot find module '../speculation-rules.js'`).

- [ ] **Step 3: Create the module**

Create `packages/server/src/speculation-rules.ts`:

```ts
import type { AppConfig } from '@hono-preact/iso';

const SPECULATION_RULES_JSON =
  '{"prefetch":[{"where":{"and":[' +
  '{"href_matches":"/*"},' +
  '{"not":{"selector_matches":"[data-no-prefetch]"}}' +
  ']},"eagerness":"moderate"}]}';

export const SPECULATION_RULES_TAG =
  `<script type="speculationrules">${SPECULATION_RULES_JSON}</script>`;

export function speculationRulesTag(config: AppConfig): string {
  return config.speculation === true ? SPECULATION_RULES_TAG : '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/server/src/__tests__/speculation-rules.test.ts`

Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/speculation-rules.ts packages/server/src/__tests__/speculation-rules.test.ts
git commit -m "feat(server): add speculationRulesTag pure module

Emits the static <script type=\"speculationrules\"> string when an
AppConfig has speculation: true; otherwise empty. Not yet wired into
the render path; that lands in the next task."
```

---

## Task 3: Wire `speculationRulesTag` into `render.tsx` (TDD)

The render path builds a `headTags` array at `packages/server/src/render.tsx:226-232` and injects it via `html.replace('</head>', …)`. We add a call to `speculationRulesTag(options?.appConfig ?? {})` to that array. The integration test exercises the wired path through `renderPage`.

**Files:**
- Modify: `packages/server/src/render.tsx`
- Create: `packages/server/src/__tests__/render-speculation.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `packages/server/src/__tests__/render-speculation.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { JSX } from 'preact';
import { defineApp } from '@hono-preact/iso';
import { renderPage } from '../render.js';
import { SPECULATION_RULES_TAG } from '../speculation-rules.js';

function LinkyPage(): JSX.Element {
  return (
    <html>
      <head></head>
      <body>
        <a href="/about">About</a>
        <a href="/logout" data-no-prefetch>Sign out</a>
      </body>
    </html>
  );
}

async function renderAndGetBody(
  options?: Parameters<typeof renderPage>[2]
): Promise<string> {
  const app = new Hono();
  app.get('*', (c) => renderPage(c, <LinkyPage />, options));
  const res = await app.request('http://localhost/');
  return await res.text();
}

describe('renderPage speculation rules', () => {
  it('omits the speculation rules tag when AppConfig is not provided', async () => {
    const body = await renderAndGetBody();
    expect(body).not.toContain('speculationrules');
  });

  it('omits the speculation rules tag when speculation is false', async () => {
    const appConfig = defineApp({ speculation: false });
    const body = await renderAndGetBody({ appConfig });
    expect(body).not.toContain('speculationrules');
  });

  it('omits the speculation rules tag when speculation is omitted on AppConfig', async () => {
    const appConfig = defineApp({});
    const body = await renderAndGetBody({ appConfig });
    expect(body).not.toContain('speculationrules');
  });

  it('emits the speculation rules tag exactly once in <head> when speculation is true', async () => {
    const appConfig = defineApp({ speculation: true });
    const body = await renderAndGetBody({ appConfig });

    const occurrences = body.split(SPECULATION_RULES_TAG).length - 1;
    expect(occurrences).toBe(1);

    const headEnd = body.indexOf('</head>');
    const tagAt = body.indexOf(SPECULATION_RULES_TAG);
    expect(headEnd).toBeGreaterThan(-1);
    expect(tagAt).toBeGreaterThan(-1);
    expect(tagAt).toBeLessThan(headEnd);
  });

  it('preserves data-no-prefetch attribute on rendered links', async () => {
    const appConfig = defineApp({ speculation: true });
    const body = await renderAndGetBody({ appConfig });
    expect(body).toContain('data-no-prefetch');
  });
});
```

- [ ] **Step 2: Run tests to verify the four "tag present" assertions fail**

Run: `pnpm vitest run packages/server/src/__tests__/render-speculation.test.tsx`

Expected: the three "omits the tag" tests PASS (the tag isn't wired in yet, so it's absent). The "emits the speculation rules tag exactly once" test and the "preserves data-no-prefetch" test should run too; the data-no-prefetch attribute should already round-trip through Preact's HTML serialization, so that one may pass. The "emits ... exactly once" test FAILS because the tag is not yet emitted.

- [ ] **Step 3: Modify `render.tsx` to call `speculationRulesTag`**

Open `packages/server/src/render.tsx`. Near the top of the file, add to the imports:

```ts
import { speculationRulesTag } from './speculation-rules.js';
```

Then find the `headTags` build at lines 226-232:

```ts
const headTags = [
  titleSource != null ? `<title>${escapeHtml(titleSource)}</title>` : '',
  ...metas.map((m) => `<meta ${toAttrs(m)} />`),
  ...links.map((l) => `<link ${toAttrs(l)} />`),
]
  .filter(Boolean)
  .join('\n        ');
```

Replace with:

```ts
const headTags = [
  titleSource != null ? `<title>${escapeHtml(titleSource)}</title>` : '',
  ...metas.map((m) => `<meta ${toAttrs(m)} />`),
  ...links.map((l) => `<link ${toAttrs(l)} />`),
  speculationRulesTag(options?.appConfig ?? {}),
]
  .filter(Boolean)
  .join('\n        ');
```

The `.filter(Boolean)` already drops the empty string when speculation is off; no additional branching needed.

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm vitest run packages/server/src/__tests__/render-speculation.test.tsx`

Expected: all 5 tests PASS.

- [ ] **Step 5: Run the wider render test suite to confirm no regressions**

Run: `pnpm vitest run packages/server/src/__tests__/render`

Expected: existing `render.test.tsx`, `render-cookie-smoke.test.tsx`, `render-honocontext.test.tsx`, `render-loader-c.test.tsx`, `render-stream.test.tsx` all still pass. None of them set `speculation: true`, so behavior is unchanged for them.

- [ ] **Step 6: Run the full server package test suite**

Run: `pnpm vitest run packages/server`

Expected: all tests PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/render.tsx packages/server/src/__tests__/render-speculation.test.tsx
git commit -m "feat(server): emit speculation rules tag in <head> when opted in

renderPage now joins speculationRulesTag(appConfig) into the headTags
array. Default (speculation omitted or false) leaves the rendered HTML
byte-identical to today's output."
```

---

## Task 4: Document the feature

Add a new docs page describing what the feature does, how to enable it, and how to opt links out. Follow the `add-docs-page` local skill convention: create the MDX file and register it in `nav.ts`. Per `feedback_docs_no_migration_breadcrumbs`, describe what is; no "previously / formerly / replaces" language.

**Files:**
- Create: `apps/site/src/pages/docs/link-prefetch.mdx`
- Modify: `apps/site/src/pages/docs/nav.ts`

- [ ] **Step 1: Create the docs page**

Create `apps/site/src/pages/docs/link-prefetch.mdx`:

```mdx
# Link Prefetch

Tell the browser to prefetch destinations the user is likely to navigate to next. When enabled, the server emits a single `<script type="speculationrules">` tag in `<head>` that instructs supporting browsers (Chrome, Edge) to prefetch same-origin `<a href>` links on moderate eagerness: roughly, the browser fetches the destination's HTML and dependent resources when the user hovers or touches a link, well before they click. Navigation feels instant when the prefetch lands.

The feature is off by default. Browsers without Speculation Rules support (Safari, Firefox) silently ignore the tag.

## Enabling

Set `speculation: true` on your `defineApp` config:

```ts
import { defineApp } from 'hono-preact';

export const appConfig = defineApp({
  speculation: true,
});
```

Once enabled, every server-rendered page emits the speculation rules tag. No per-route configuration.

## What gets prefetched

The emitted rule applies to every same-origin `<a href>` link rendered in the page. Cross-origin links are skipped automatically.

The browser decides when to prefetch based on the `moderate` eagerness setting: pointer hover or touchstart usually triggers it, click-time is too late. The prefetched response counts as a normal `GET` against your server.

## Opting individual links out

Some links should never be prefetched: ones that mutate server state via a `GET` (logout, sign-out, unsubscribe), generate signed URLs that count against a quota, or otherwise have side effects on fetch. Mark them with the `data-no-prefetch` attribute:

```tsx
<a href="/logout" data-no-prefetch>Sign out</a>
```

The browser excludes any link matching `[data-no-prefetch]` from the rule. Plain HTML attribute; works on any `<a>` element.

## Auditing before enabling

The framework cannot tell which of your `GET` routes are safe to prefetch. Before flipping `speculation: true` on, review your app for routes where a `GET` does any of:

- Records a write (analytics ping, view-counter increment, audit log).
- Burns a one-shot token (signed-URL with single-use semantics).
- Triggers a side effect (sends an email, decrements a quota, expires a session).

Add `data-no-prefetch` to the links that lead to those routes, or refactor them to `POST` so prefetch never fires. The framework's mutation pattern is `POST`-only by design; route-level GETs are expected to be idempotent.

## Strict-CSP apps

The emitted script is a normal `<script>` element and is subject to your `Content-Security-Policy`. Apps with strict CSPs that don't allow inline scripts will see the speculation script blocked by the browser. The framework does not currently plumb a CSP nonce. If your app needs Speculation Rules under strict CSP, file an issue describing the use case.
```

- [ ] **Step 2: Register the page in `nav.ts`**

Open `apps/site/src/pages/docs/nav.ts`. Find the `Infrastructure` section near the bottom of the file:

```ts
{
  heading: 'Infrastructure',
  entries: [
    { title: 'Vite Config', route: '/docs/vite-config', icon: Settings },
    {
      title: 'Project Structure',
      route: '/docs/structure',
      icon: FolderTree,
    },
    {
      title: 'Composing Hono Middleware',
      route: '/docs/hono-middleware',
      icon: Plug,
    },
    { title: 'WebSockets', route: '/docs/websockets', icon: Cable },
    { title: 'renderPage', route: '/docs/render-page', icon: Layers },
    { title: 'Build & Deploy', route: '/docs/deployment', icon: Cloud },
  ],
},
```

The icon imports already include `Zap` (used by the existing Prefetching docs page). Reuse it for Link Prefetch. Insert the new entry above `Build & Deploy` so deployment stays as the last entry:

```ts
{
  heading: 'Infrastructure',
  entries: [
    { title: 'Vite Config', route: '/docs/vite-config', icon: Settings },
    {
      title: 'Project Structure',
      route: '/docs/structure',
      icon: FolderTree,
    },
    {
      title: 'Composing Hono Middleware',
      route: '/docs/hono-middleware',
      icon: Plug,
    },
    { title: 'WebSockets', route: '/docs/websockets', icon: Cable },
    { title: 'renderPage', route: '/docs/render-page', icon: Layers },
    { title: 'Link Prefetch', route: '/docs/link-prefetch', icon: Zap },
    { title: 'Build & Deploy', route: '/docs/deployment', icon: Cloud },
  ],
},
```

- [ ] **Step 3: Verify the docs build**

Run: `pnpm --filter site build`

Expected: clean Vite build with no broken-link or missing-page errors.

- [ ] **Step 4: Smoke-test in the dev server**

Run: `pnpm --filter site dev`

Open `http://localhost:<port>/docs/link-prefetch` in a browser. Verify:
- The page renders.
- The "Link Prefetch" entry appears in the sidebar's Infrastructure section.
- The Zap icon shows next to it.

Stop the dev server (`Ctrl-C`) when done.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/docs/link-prefetch.mdx apps/site/src/pages/docs/nav.ts
git commit -m "docs(site): add Link Prefetch page

Documents the AppConfig.speculation opt-in flag and the
data-no-prefetch attribute. Includes a brief audit guide for apps
considering whether their GET routes are safe to prefetch."
```

---

## Task 5: Final verification

A single end-to-end check that all the pieces compose: the full test suite plus the docs build.

- [ ] **Step 1: Run the full repo test suite**

Run: `pnpm test`

Expected: all packages green. If any tests fail that look unrelated, check whether they were already flaky on `main`; do not paper over real regressions.

- [ ] **Step 2: Type-check the whole workspace**

Run: `pnpm typecheck`

Expected: clean. This is the workspace-wide `tsc --noEmit`.

- [ ] **Step 3: No commit for this task**

This is a verification-only task. No file changes to commit. The unit test in Task 2 asserts the byte-stable tag string, and the integration test in Task 3 asserts the full SSR-rendered HTML places the tag in `<head>` exactly once when opted in. Those two together give stronger evidence than a manual dev-server check; no manual smoke test step is needed.

---

## Out of scope (documented in the spec, not implemented here)

- CSP nonce plumbing. Mentioned in the docs page as a known limitation.
- Per-route prefetch flags or path exclusion lists. Use `data-no-prefetch` on individual links instead.
- Programmatic client-side speculation API.
- Prerender mode (full background render). Prefetch only in v1.

## Release sequencing

Sits on `main` alongside Spec A (shipped 2026-05-23, PRs #56/#58) and Spec C (shipped 2026-05-24, PR #59). `v0.3.0` cuts once this lands, with `create-hono-preact@0.3.0` in lockstep per the release versioning policy. Spec B is deferred pending upstream `preact-iso` Navigation API support; Spec D was shelved 2026-05-24 as redundant with the existing async-generator loader streaming.
