import { defineApp } from 'hono-preact';

// Dogfood the framework's Speculation Rules emitter: the docs site is navigation-
// heavy with same-origin, idempotent GET routes, so prefetch-on-moderate-eagerness
// is a real win (and the docs tell users to enable exactly this). The generated
// server entry picks up this default export automatically. Per-link opt-out is
// `data-no-prefetch`; cross-origin links (npm, GitHub) are never prefetched.
export default defineApp({ speculation: true });
