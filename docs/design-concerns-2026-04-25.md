# Open design concerns — 2026-04-25 review

Punch-list of design/footgun concerns identified in a deep review of the recent feature work (streaming actions, file uploads, action guards, cache registry, unified loader). Each is a non-obvious finding worth revisiting, not a confirmed bug.

## 1. `<Form>` doesn't handle streaming actions

`packages/iso/src/form.tsx:60-72` reads `response.text()` then `JSON.parse`. A form-bound action returning a `ReadableStream` (Content-Type `text/event-stream`) will throw on parse. Either disallow streaming for `<Form>` (and document) or mirror the `useAction` content-type branch.

## 2. `<Form>` injects inline style on the wrapping fieldset

`form.tsx:93` hardcodes `style={{ border: 'none', padding: 0, margin: 0 }}`. Overrides any user CSS. Switch to a class (or data attribute) so it's overridable.

## 3. `cacheRegistry` has no unregister and no collision warning

`packages/iso/src/cache-registry.ts:4-6` — `Map.set` silently overwrites on duplicate names. With code-splitting / dev HMR, name collisions across pages are silent. At minimum, log a dev-mode warning when registering an existing name.

## 4. `hasFileValues` is one-level deep

`packages/iso/src/action.ts:34-38` only inspects own enumerable values. Nested payloads like `{ form: { poster: file } }` won't switch to multipart. Acceptable as a documented limit, but `actions.mdx:177-186` implies any payload with a File works — tighten the wording.

## 5. `loadersHandler` doesn't validate `location`

`packages/server/src/loaders-handler.ts:65-67` only checks `module`. Missing/malformed `location` falls through to the user loader, which likely crashes on `location.pathParams.id`. Validate shape or default to `{}`.

## 6. Actions/loaders map cache vs. HMR

`actions-handler.ts:55` and `loaders-handler.ts:39` cache the resolved module map for the closure's lifetime. Edits to `.server.ts` files in `vite dev` won't take effect until the server restarts. Either invalidate on a dev header or document.

## 7. Status-code cast in `ActionGuardError` path

`actions-handler.ts:131` casts `err.status` to `400|401|403|404|429|500` — but `ActionGuardError`'s constructor accepts any number, so the cast is a TS lie. Either constrain the constructor type or widen the response type.
