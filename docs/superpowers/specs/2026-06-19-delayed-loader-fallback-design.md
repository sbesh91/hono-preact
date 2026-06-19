# Delayed loader fallback

**Date:** 2026-06-19
**Status:** Design approved, ready for implementation plan
**Scope:** `@hono-preact/iso` (loader Suspense fallback only)

## Problem

On fast connections, a loader's fallback (loading UI) flashes on screen for a
few milliseconds before the data lands. The fallback "gets in the way": it is
visible just long enough to register as a flicker, which is worse than showing
nothing at all for a sub-perceptual fetch.

The fix is the standard delayed-spinner pattern: wait a short interval before
mounting the loading state, and skip it entirely if the response arrives first.

## Decisions (from brainstorming)

These were settled with the requester before this design:

- **Mechanism: automatic + overridable.** The framework applies the delay to
  loader fallbacks by default; authors can change or disable it per loader. No
  manual opt-in wrapper is required for the default behavior.
- **Scope: the loader data fallback only.** The `fallback` rendered by
  `loader.Boundary` / `loader.View` (the `<Suspense fallback>` in `LoaderHost`).
  The page-level route boundary (lazy-chunk Suspense) and the non-Suspense
  `reloading` flag from `useReload()` are out of scope.
- **Override surface: per `defineLoader`.** The delay is a property of the loader
  definition, with a built-in default. No global `defineApp` config knob and no
  per-`Boundary`/`View` prop.
- **Just the delay.** No companion "minimum display time" feature. The
  reverse-flash (fallback mounts then vanishes if data lands just after the
  threshold) is rare and can be added later if it bites.
- **Implementation: delayed-fallback wrapper component (Approach A).** Wrap the
  `fallback` in a component that renders nothing for the delay window, rather
  than deferring the suspend itself in the loader runner (Approach B). Approach A
  matches the request literally, keeps the change small and isolated, and carries
  no SSR/streaming risk. Its only visible difference from B is a brief blank
  region during the sub-delay window instead of held-stale content.

## Context: how loader loading state works today

All routing/loading machinery lives in `packages/iso`.

- `loader.Boundary` / `loader.View` accept a `fallback` prop
  (`packages/iso/src/define-loader.ts`). It flows into `LoaderHost`.
- `LoaderHost` renders `<Suspense fallback={fallback}>` around a `DataReader`
  (`packages/iso/src/internal/loader.tsx:55-61`). `DataReader` calls
  `reader.read()`, which throws the in-flight promise; that throw is the instant
  the fallback appears.
- The delay lives on the loader ref and is read inside `LoaderHost`, so both
  `Boundary` and `View` (which delegates to `Boundary`) inherit it with no
  signature change.
- The `reloading` path (`use-loader-runner.tsx`, surfaced via `useReload()`)
  does **not** suspend, so it never renders this fallback and is unaffected.
- SSR uses preact-iso's `prerender`, which awaits loader suspensions
  (non-streaming) or streams data chunks via `window.__HP_STREAM__` scripts
  (streaming) rather than emitting Suspense fallback HTML
  (`packages/server/src/render.tsx`). The loader fallback therefore essentially
  never appears in server output, so a delayed fallback has near-zero
  SSR/hydration blast radius.

## Design

### 1. Public API

One new optional field on `DefineLoaderOpts<T>`, mirroring `timeoutMs` in shape
and validation:

```ts
defineLoader(fn, {
  fallbackDelay: 100, // ms to wait before mounting the fallback.
                      // Omitted -> DEFAULT_FALLBACK_DELAY_MS (100).
                      // 0 -> show immediately (pre-feature behavior).
});
```

- Type: `fallbackDelay?: number`. Must be a non-negative finite number;
  validated the same way `timeoutMs` is (`validateTimeoutMs` pattern), throwing
  `RangeError` on `NaN`, negative, or non-finite input.
- Stored as `readonly fallbackDelay?: number` on `LoaderRef<T>`.
- No new prop on `loader.Boundary` / `loader.View`. No global config knob.

### 2. New internal component

`packages/iso/src/internal/delayed-fallback.tsx` (not exported publicly):

```tsx
export const DEFAULT_FALLBACK_DELAY_MS = 100;

function DelayedFallback({
  delay,
  children,
}: {
  delay: number;
  children: ComponentChildren;
}) {
  const immediate = typeof window === 'undefined' || delay <= 0;
  const [show, setShow] = useState(immediate);
  useEffect(() => {
    if (immediate) return;
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay, immediate]);
  return show ? children : null;
}
```

- `immediate` is `true` on the server (`typeof window === 'undefined'`) so SSR
  and hydration output is identical to today; the wrapper is transparent off the
  client. The delay applies only to in-browser navigations.
- `delay <= 0` also resolves to `immediate`, so `fallbackDelay: 0` opts out.
- The timer lifecycle rides Suspense's mount/unmount: Suspense mounts the
  fallback subtree only while suspended and unmounts it on resolve, so a fast
  response unmounts `DelayedFallback` before the timer fires, the cleanup clears
  it, and the loading UI never paints.

### 3. Wiring in `LoaderHost` (`loader.tsx`)

```tsx
const delay = loaderRef.fallbackDelay ?? DEFAULT_FALLBACK_DELAY_MS;
const wrapped =
  fallback == null ? (
    fallback
  ) : (
    <DelayedFallback delay={delay}>{fallback}</DelayedFallback>
  );
// <Suspense fallback={wrapped}> ... </Suspense>
```

When no `fallback` is supplied, nothing is wrapped (there is no loading UI to
delay).

### 4. Behavior summary

| Case | Result |
| --- | --- |
| Response lands before `delay` | Fallback never mounts (the goal). |
| Response lands at/after `delay` | Region blank for `delay` ms, then fallback mounts. |
| `fallbackDelay: 0` | Fallback mounts immediately (pre-feature behavior). |
| SSR / hydration | Unchanged; server renders immediately, and non-streaming loaders never render the fallback into HTML. |
| Explicit `reload()` | Unaffected; the reload path does not suspend. |
| `loader.View` and `loader.Boundary` | Both covered, no signature change. |

During the blank window on a client navigation the surrounding layout persists;
only the loader-bounded region is blank, for at most `delay` ms.

## Testing

- **Unit (`delayed-fallback`):** fake timers + `act()`.
  - Renders `null` before `delay`, the children after.
  - `delay <= 0` renders immediately.
  - Unmounting before `delay` never shows the children (timer cleared).
  - Server path (`window` undefined) renders immediately.
- **Integration (`loader.tsx` / `defineLoader`):**
  - A loader that stays pending: no fallback in the DOM before 100ms, present
    after.
  - A loader that resolves before 100ms: fallback never appears.
  - Custom `fallbackDelay` honored.
  - `fallbackDelay: 0` shows the fallback immediately.
- **Type (`*.test-d.ts`):** `DefineLoaderOpts` accepts `fallbackDelay`;
  `LoaderRef.fallbackDelay` is `number | undefined`.
- **Validation:** `defineLoader({ fallbackDelay: -1 })` and `NaN` throw
  `RangeError`.

## Files touched

- `packages/iso/src/internal/delayed-fallback.tsx` (new): `DelayedFallback`,
  `DEFAULT_FALLBACK_DELAY_MS`.
- `packages/iso/src/internal/loader.tsx`: wrap the Suspense `fallback`.
- `packages/iso/src/define-loader.ts`: add `fallbackDelay` to
  `DefineLoaderOpts` and `LoaderRef`, store it on the ref, validate it.
- Tests under `packages/iso/src/internal/__tests__/` and/or
  `packages/iso/src/__tests__/`.

## Out of scope / future work

- Minimum display time (avoid the reverse-flash when data lands just after the
  threshold).
- Delaying the page-level route boundary (lazy-chunk) fallback, which would also
  require giving `Page`/`definePage` a fallback API it does not have today.
- Debouncing the `reloading` flag from `useReload()`.
- A global `defineApp` default or a per-`Boundary`/`View` prop override.
