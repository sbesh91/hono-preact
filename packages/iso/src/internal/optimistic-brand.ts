/**
 * The optimistic-action brand symbol, isolated in a dependency-free leaf.
 *
 * A branded action carries `[OPTIMISTIC_BRAND]` so `<Form>` can detect optimistic
 * support with an `OPTIMISTIC_BRAND in action` check. Form needs only the symbol,
 * not the optimistic runtime, so it imports the brand from here rather than from
 * `optimistic-action.js` (whose graph pulls `optimistic.js` / `useOptimistic`).
 * Keeping that edge out of `form.js` lets a bundler avoid co-locating the
 * optimistic runtime into a plain, non-optimistic form route's chunk.
 *
 * The single `Symbol()` call lives here, so every importer (Form and
 * optimistic-action) shares one identity, and the `unique symbol` type flows to
 * consumers that use `[OPTIMISTIC_BRAND]` as a computed property key.
 */
export const OPTIMISTIC_BRAND: unique symbol = Symbol('hono-preact.optimistic');
