# PWA and service-worker support: investigation

**Date:** 2026-07-21
**Status:** Design agreed; not yet scheduled
**Scope of this document:** the PWA platform layer (web app manifest, service worker, precache, install, update lifecycle). The offline **data** layer and **Web Push** are designed around but deliberately deferred; see "Deferred follow-ons".

---

## 1. Summary

The framework has no PWA surface today. Adding one is mostly a *build* problem rather than a runtime problem, because the framework already computes the hard input: `PreloadArtifact` knows the client entry's static-import closure, the per-route chunk chains, the per-route CSS, and the global CSS. That is strictly better information than the output-directory glob that every off-the-shelf PWA tool precaches from.

Decisions reached:

| Question | Decision |
|---|---|
| Who owns the service worker | The framework owns generation, registration, and build wiring. `workbox-precaching` / `workbox-background-sync` are used as internal libraries. `vite-plugin-pwa` is **not** adopted. |
| User-facing tiers | `pwa: true` (zero app code) and `pwa: { sw }` (full eject). |
| Manifest | One completely typed `defineManifest()`, validated at build time. |
| Offline navigation | Network-first, falling back to a build-time branded offline page. |
| Where the SW is emitted | Origin root (`/sw.js`), not under `/static/`. |
| Update policy | New worker waits. No `skipWaiting()` by default. |
| Dev mode | Service worker disabled by default; opt-in flag. |
| `apps/site` | Deliberately does **not** consume this. |

The governing filter for what belongs in the framework is **long-term public API surface cost**, not Baseline support status. See section 4.

---

## 2. Current state

There is no service worker, no web app manifest, and no `workbox` or `vite-plugin-pwa` dependency anywhere in the repo. The only occurrence of "PWA" in the tree is a passing mention in a competitor-comparison research doc.

The pieces a PWA layer has to integrate with:

| Piece | Location | Relevance |
|---|---|---|
| Build asset graph | `packages/vite/src/preload-manifest.ts` (`PreloadArtifact`: `closure`, `routes`, `routeCss`, `globalCss`) | The precache list, already computed |
| Client build config | `packages/vite/src/hono-preact.ts:155-161` | Where a second rollup input has to go |
| Client entry filename | `packages/iso/src/internal/contract.ts:22` (`CLIENT_ENTRY_FILE = 'static/client.js'`) | A fixed string, which constrains the SW entry (section 6.1) |
| Head injection | `packages/server/src/document-shell.ts` (`HeadStatic.links`) | Existing path for `<link rel="manifest">` |
| Streaming SSR | `packages/server/src/document-shell.ts`, `stream-pump.ts` | Why there is no natural static app shell |
| Loader data RPC | `POST /__loaders` (`contract.ts:16`) | Central to the deferred data layer, not to this cut |
| Adapters | `packages/vite/src/adapter-cloudflare.ts`, `adapter-node.ts` | Root-asset emission differs |

---

## 3. Platform survey (verified July 2026)

### 3.1 Baseline status of the platform-integration tier

Only two capabilities in the whole tier are Baseline **Widely Available**: Push, and service-worker / installed-app Notifications (both reached high Baseline 2025-09-27). Everything else, *including the web app manifest itself*, is **Limited**, because Firefox desktop does not implement manifest-driven install and Safari implements a subset.

| Capability | Baseline | Install required | SW required | Server state |
|---|---|---|---|---|
| Push + SW Notifications | Widely available | iOS only | Classic yes; Declarative no | Substantial |
| Badging | Limited | iOS yes | No | None (but see push) |
| Share Target | Limited | Yes | No | A route |
| File Handlers | Limited | Yes | No | None |
| Protocol Handlers | Limited | Yes | No | None |
| Launch Handler / WCO / tabbed | Limited | Yes | No | None |
| App shortcuts | Limited | Yes | No | None |
| Periodic Background Sync | Limited | Yes, plus engagement gate | Yes | None |
| Background Fetch | Limited | No | Yes | Range-friendly assets |
| Web app manifest itself | Limited | n/a | No | None |

### 3.2 Findings that changed the design

**Declarative Web Push is standardized, not a WebKit side quest.** It shipped in Safari 18.4 (iOS/iPadOS) and 18.5 (macOS), and was absorbed into the W3C Push API Working Draft on 2025-12-01. Mozilla's position is positive and Mozilla now co-edits the spec. The payload is `Content-Type: application/notification+json` with `{"web_push": 8030, "notification": {title, navigate, ...}, "mutable": bool, "app_badge": n}`; `title` and `navigate` are required. Safari renders it with **no service worker at all**, and any UA that does not understand it falls through to a normal `push` event carrying the identical JSON. One payload, two delivery paths, no branching in app code.

> Source conflict, resolved: the WebKit explainer README still documents an older schema (`default_action_url`, nested `options`). Build against the W3C Working Draft, not the explainer.

**The Service Worker static routing API belongs in this cut, not in the deferred platform work.** Chrome 123, and now in the Safari 27 beta. It lets a service worker declare routing rules so the browser bypasses SW startup entirely for matching requests. A framework that emits its own SW should emit static routes for its content-hashed immutable assets. An application author would not think to do this; we already hold the hashed-asset list.

**iOS 26 removed all installability requirements.** Any site added to the Home Screen now opens as a web app by default, and the manifest is purely additive on Apple platforms. The familiar "you need `display: standalone` or iOS will not install you" rule is dead on current iOS, though it still governs iOS 16.4 through 18.x.

**Background Sync and Periodic Background Sync are Mozilla-*negative*,** not merely unimplemented, and unimplemented in WebKit (bug 204117, open since 2019). This is a formal position against, so the "replay on service-worker startup" fallback is the permanent path for two of three engines, not a stopgap.

**Notification `actions`** reached Firefox 152 (2026-06-16) and remain unimplemented in Safari on every platform.

**Richer install UI** requires `screenshots` plus `description`, with constraints worth validating at build time: each side 320 to 3840px, maximum dimension no more than 2.3x the minimum, and all screenshots of a given `form_factor` sharing an aspect ratio.

---

## 4. The filter: API surface cost, not Baseline

The repo's standing constraint is that primitives may rely only on Baseline Widely Available features, with Newly Available features used as progressive enhancement. Applying that rule to PWA capabilities is a category error, and this investigation initially made it.

The rule exists for primitives, where an unsupported feature means a broken component. PWA capabilities are different: when one is absent, the application is simply a website. The failure mode is graceful by construction. PWA features are progressive enhancement by definition, so Baseline status cannot be the gate.

What replaces it is **long-term public API surface cost**, which this repo already treats as a first-class review concern. The question is not "will this work in Firefox" but "is this surface worth carrying, documenting, and never breaking". That re-sorts the list, and in one place it argues for more coverage rather than less:

- **Type the manifest completely.** A partial manifest type is *more* surface than a complete one, because it forces an escape hatch (`extra: Record<string, unknown>`) and then both the type and the hole need maintaining. The marginal cost of the tenth field in a single validated object is near zero, and the build-time validation is where the value lives regardless of engine support.
- **Be selective about runtime helpers.** Each is a separate named export with its own semantics, docs page, and compat surface. The test is whether the framework holds information the app does not. Emitting content-hashed icons passes. Wrapping `launchQueue` consumption or Window Controls Overlay geometry does not: those are application chrome, and a wrapper adds indirection over an API the app must understand anyway.
- **Wrap nothing whose behavior is unreliable when present.** Periodic Background Sync is the sharp case, and it fails on grounds that survive the progressive-enhancement argument. Even in Chrome, where it is implemented, the browser gates firing on a site-engagement score and chooses the cadence itself. An API shaped like `periodicSync({ everyHours: 12 })` is misleading where it is supported, not merely inert where it is not. The raw event stays reachable from an ejected service worker; it should not get a framework promise wrapped around it.

---

## 5. Build versus adopt

`vite-plugin-pwa` was seriously considered and rejected on integration risk, not on quality.

**What the ecosystem tooling genuinely provides:** a precache manifest with revisions and stale-cache cleanup; the update lifecycle handshake; `workbox-background-sync`, whose Queue already replays on service-worker startup where the Background Sync API is absent, which is exactly the shape two of three engines need permanently; manifest and icon generation; and dev-mode SW handling.

**What it does not provide, for this framework specifically:**

- `/__loaders` is a **POST**. The Cache API refuses to store POST responses, so every Workbox caching strategy (`StaleWhileRevalidate`, `NetworkFirst`, `CacheFirst`) is inapplicable to this framework's only data endpoint. Offline loader data requires a bespoke IndexedDB-backed handler regardless of tooling.
- Workbox precaches by globbing the output directory. `PreloadArtifact` already distinguishes the boot closure from per-route chunks, which is what allows precaching the boot set and runtime-caching route chunks instead of downloading the entire application on install.
- Guard-aware cache partitioning, the loader-state integration, and the streaming-SSR navigation strategy are all framework-specific either way.

**The deciding factor** is that `vite-plugin-pwa`'s Vite Environment API support is an open pull request (vite-pwa/vite-plugin-pwa#903), last updated January 2026. This framework's build is Environment-API-driven end to end: `@cloudflare/vite-plugin ^1.37.1` drives both workerd dev and the production build through it. That PR's own summary notes it "skips PWA asset generation for SSR builds", while every build here is a multi-environment client plus SSR build. Adopting it would gate the feature on unmerged upstream work, in exchange for the parts we get least value from.

Workbox the library is healthy (owned by Chrome's Aurora team, actively released). It is specifically the build-integration layer that does not fit. Hence: framework-owned build integration, Workbox sub-packages as internal dependencies for the genuinely solved problems.

One intuition worth correcting: the usual bundle-size objection to Workbox is weak here. Service-worker bytes are off the page's critical path, and the `client-size` CI job measures page JS, so a few KB inside the SW costs nothing currently tracked.

---

## 6. Design

### 6.1 Code layout

The repo splits packages by *environment* (`vite` = build, `iso` = isomorphic runtime, `server` = server handlers, `hono-preact` = public facade), not by feature. A feature-shaped `packages/pwa` would cut against that grain and produce a package that is simultaneously a build plugin and a runtime. Follow the existing grain instead:

- `packages/vite/src/pwa/` : service-worker rollup input, manifest emission and validation, precache-list derivation from `PreloadArtifact`, offline-page generation.
- `packages/iso/src/pwa/` : registration, update lifecycle, install-prompt handling.
- `packages/server/src/document-shell.ts` : reused for `<link rel="manifest">` injection through the existing `HeadStatic.links` path, and for rendering the offline page at build time so it carries real application chrome rather than a second HTML templating path.
- New public entrypoints: `hono-preact/pwa` (page-side) and `hono-preact/sw` (composable handlers, eject path only).

### 6.2 Tiers

```
Tier 0   honoPreact({ pwa: true })
         Installable, precached, offline-page-capable. Zero application code.

Tier 1   honoPreact({ pwa: { sw: './src/sw.ts' } })
         The app writes the service worker, composing exported handlers
         from 'hono-preact/sw'.
```

A middle tier (a configuration-level slot for an app-supplied store) was designed and belongs with the offline data layer; see "Deferred follow-ons".

### 6.3 Service-worker build

Two constraints follow from the current build configuration:

1. **Filename collision.** The client build sets `rollupOptions.input: [clientEntry]` with `entryFileNames: CLIENT_ENTRY_FILE` (`hono-preact.ts:155-161`), and that constant is the fixed string `static/client.js`. A second input would collide on it. The fix is function-form `entryFileNames` keyed on entry name, preserving the client entry's URL, which is a documented wire contract.

2. **Emission at the origin root.** A service worker's default scope is its own directory, so `/static/sw.js` could only ever control `/static/`. The alternative, a `Service-Worker-Allowed` header, requires cooperating changes in both the Cloudflare assets path and the Node adapter. Emitting at `/sw.js` is strictly simpler and is the chosen approach.

### 6.4 Precaching

Precache the boot closure plus global CSS; runtime-cache per-route chunks and per-route CSS on first use. Blanket-precaching every route chunk would download the entire application at install time, which is the behavior that gives generated service workers their reputation. Avoiding it is possible only because `PreloadArtifact` separates `closure` from `routes`, information a glob-based tool does not have.

Additionally, emit **static routing rules** for content-hashed immutable assets so the browser skips service-worker startup on them entirely.

### 6.5 Manifest

One `defineManifest()` object, completely typed and validated at build time. Validation covers what nobody remembers: required icon sizes and the maskable safe zone, the richer-install-UI screenshot constraints (320 to 3840px per side, maximum no more than 2.3x minimum, consistent aspect ratio per `form_factor`), `%s` templates in `protocol_handlers`, ordered-fallback semantics in `display_override`, and coherence between `id`, `scope`, and `start_url`. Icons are content-hashed and emitted through the existing asset pipeline.

### 6.6 Offline navigation

Network-first, falling back to a build-time-generated branded offline page rendered through `document-shell.ts`.

The alternative considered and deferred is a **shell fallback**: serve an empty shell document and let the client router render the route. That is the correct long-term design, but its value depends entirely on cached loader data. Without the data layer, an offline navigation would reach the shell, mount the route, and resolve its loaders to cold errors, presenting `errorFallback` inside the application chrome. That reads as broken and is hard to document. The shell fallback is the planned upgrade once the data layer lands; the offline page is the honest behavior until then.

### 6.7 Update lifecycle

The new worker waits. No `skipWaiting()` by default. The framework exposes an update hook and the application decides when to prompt.

This framework has a sharper reason than most. Route chunks are dynamically imported by content hash. If a new worker activates and purges the old precache beneath a tab that is still running, that tab's next navigation requests a chunk hash that no longer exists and the navigation breaks. Note the inversion this implies: a service worker that *retains* old chunks makes an open tab **more** resilient to a mid-session deploy than the site is today.

### 6.8 Install

`beforeinstallprompt` capture and a typed prompt trigger on Chromium. On current iOS nothing is required beyond being added to the Home Screen; the iOS 16.4-18.x rule (`display` set to `standalone` or `fullscreen`) should be documented as legacy guidance rather than baked into validation as an error.

### 6.9 Dev mode

The service worker is disabled in dev by default, with an opt-in flag to exercise it. A stale cache masking source edits is the single most common way a PWA wastes a developer's afternoon.

---

## 7. Testing

Follows the pattern `preload-manifest.ts` already establishes: precache-list derivation and manifest validation are pure functions over a bundle-like input, unit-testable with no real build. Service-worker runtime behavior belongs in `test:integration`. The CI Lighthouse job already drives Chrome, so installability assertions are cheap to add there.

---

## 8. Risks and open questions

1. **Root-level `sw.js` emission through the Cloudflare assets binding needs verification, not assumption.** Same for the Node adapter's static serving.
2. **Preview deploys leave registered service workers behind.** Each per-PR preview worker has its own `*.workers.dev` hostname, so scope is not the issue, but a worker registered while testing a preview persists in the tester's browser after that PR closes and its worker is deleted. Consider defaulting previews to no service worker.
3. **`apps/site` deliberately does not consume this.** A docs site has no use for offline capability worth the cache-invalidation risk a service worker puts on the deploy path. This breaks the repo's usual dogfooding habit and is a deliberate choice, not an oversight. Ship an opt-in capability with a demo application instead.
4. **Workbox sub-package versions** become a tracked upstream dependency, and their releases should move in lockstep the way the wrangler pins already do.

---

## 9. Deferred follow-ons

### 9.1 Offline data layer

Deferred to its own investigation. The groundwork established here:

The existing loader ADT already fits with **no new variant**. `SyncValue<T>` (`loader-state.ts:57`) exists precisely to carry "the SSR-preload / browser-cache adoption" and is consumed by `resolveCurrentValue(phase, sync)`. A persisted value enters through a seam that already exists, and the states map cleanly: adopted-and-refetching is `revalidating`, refetch-succeeded is `success`, refetch-failed-offline-with-value-retained is `staleError`, and no-cached-value-offline is the cold `error` that routes to `errorFallback`. The `staleError` / cold `error` split made for a different reason turns out to be exactly what offline-first needs.

Open problems recorded for that investigation:

- `SyncValue` adoption is synchronous and IndexedDB is not. Resolving it asynchronously guarantees a flash on every offline boot. The intended answer is a route-scoped read awaited in `bootClient()` before hydrate.
- Staleness metadata (`source`, `storedAt`) should stay off the union, exposed via a separate hook, to avoid touching every consumer for a minority case.
- Persistence must be opt-in per loader. Blanket-persisting responses would move auth-gated content from a server guarantee (`route-binding-guard.ts`) onto the user's disk, surviving logout.
- The replay queue must persist **the original POST URL**. Issue #288 made server actions guarded by POST-URL x routeId with a deny on mismatch, so replaying to a reconstructed URL would 403 on exactly the routes the guard protects. `ActionEnvelope` (`action-envelope.ts:5`) is the response shape; a request-side record does not exist yet.
- The app-supplied `OfflineStore` slot (tier 1) belongs here. It must be a module path rather than an inline function, because the service-worker build and the page build are separate rollup inputs and configuration cannot carry a closure across that boundary.

### 9.2 Web Push and the realtime bridge

Deferred, and the most differentiated opportunity found in this investigation.

Push is the only capability in the platform tier that drags in real server infrastructure: VAPID keypair (RFC 8292), payload encryption (RFC 8291), per-user subscription storage, `pushsubscriptionchange` re-registration, pruning on 404/410, and fan-out beyond the Workers subrequest cap. Infrastructure is what a framework exists to amortize. All of the cryptography is available in pure WebCrypto on Workers, so it needs no dependency.

Cloudflare mapping: subscriptions in D1 (indexed by user; KV is wrong, having no query-by-user and eventual consistency), VAPID private key via `wrangler secret`, fan-out through Queues, scheduling via Durable Object alarms.

The differentiated piece is the bridge. The repo already owns `HonoPreactRealtimeDO`, `room-engine.ts`, and per-user socket state. A Durable Object is the only component that can answer "is this user connected right now", and therefore the only place a `notify(user, payload)` API can correctly choose socket delivery over push. React Router, SvelteKit, and SolidStart all leave push to userland and none can offer this cheaply, because none owns a stateful edge primitive. Combined with Declarative Web Push's single dual-shape payload, this sits squarely inside the repo's constraints while being genuinely hard to copy.

---

## 10. Sources

Platform data verified against the webstatus.dev API (canonical Baseline source), cross-checked with MDN, caniuse, and vendor release notes.

- [W3C Push API Working Draft, 2025-12-01](https://www.w3.org/TR/push-api/)
- [Meet Declarative Web Push (WebKit)](https://webkit.org/blog/16535/meet-declarative-web-push/)
- [WebKit features in Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), [18.5](https://webkit.org/blog/16923/webkit-features-in-safari-18-5/), [26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [27 beta](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)
- [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)
- [RFC 8291 (Message Encryption for Web Push)](https://www.rfc-editor.org/rfc/rfc8291), [RFC 8292 (VAPID)](https://datatracker.ietf.org/doc/html/rfc8292)
- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Chrome: periodic background sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync), [PWA navigation management](https://developer.chrome.com/docs/capabilities/pwa-navigation-management)
- [web.dev: richer install UI](https://web.dev/patterns/web-apps/richer-install-ui), [web app manifest](https://web.dev/learn/pwa/web-app-manifest)
- [Workbox background sync](https://developer.chrome.com/docs/workbox/modules/workbox-background-sync)
- [vite-plugin-pwa#903: Vite Environment API support](https://github.com/vite-pwa/vite-plugin-pwa/pull/903)
- [MDN: share_target](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target), [display_override](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display_override), [Firefox 152 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/152)
- [Mozilla standards-positions](https://github.com/mozilla/standards-positions), [WebKit standards-positions #149](https://github.com/WebKit/standards-positions/issues/149)
