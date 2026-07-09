import { defineApp } from 'hono-preact';
import regular from '@/styles/fonts/selawik-regular.woff2?url';
import semibold from '@/styles/fonts/selawik-semibold.woff2?url';

// Dogfood the framework's Speculation Rules emitter: the docs site is navigation-
// heavy with same-origin, idempotent GET routes, so prefetch-on-moderate-eagerness
// is a real win (and the docs tell users to enable exactly this). The generated
// server entry picks up this default export automatically. Per-link opt-out is
// `data-no-prefetch`; cross-origin links (npm, GitHub) are never prefetched.
//
// Preload the two weights used above the fold (body + headings). font-display
// stays `optional` in root.css: the preload gives the brand font a real chance
// to win the optional window without risking layout shift.
export default defineApp({
  speculation: true,
  fonts: [regular, semibold],
});
