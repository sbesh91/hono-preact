# Web standards adoption — roadmap

A multi-spec wave bringing the framework onto web-standard APIs where the platform now offers what we were building ourselves. Each spec is independently shippable on `main`; no version bumps until A through E all land, then a single coordinated `v0.3.0` release (with `create-hono-preact@0.3.0` lockstep).

| Spec | Scope | Status |
|---|---|---|
| **A** | Platform hygiene: `AbortSignal` timeouts, `useOptimistic` View Transitions, `URL.parse`, TransformStream SSE codec | merged 2026-05-23 (PRs #56, #58) |
| **B** | Navigation API as primary intercept, with `preact-iso` fallback | not started |
| **C** | Progressive-enhancement forms + `/__actions` envelope reshape | not started |
| **D** | Streaming SSR upgrade via `preact-render-to-string` `renderToReadableStream` | not started |
| **E** | Speculation Rules `<script>` emitter for first-load prefetch | not started |

## Out of scope for the whole wave

Investigated and ruled out during the May 2026 web-standards audit:

- `URLPattern` as router matcher (perf regression vs radix)
- View Transitions L2 cross-document (framework is SPA after hydrate; SSR-navigation mode shelved)
- `AsyncContext.Variable` (still TC39 Stage 2)
- `Cache`/`CacheStorage` backing `LoaderCache` (wrong shape; breaks per-request isolation)
- `CompressionStream` on SSE (harms perceived latency)
- NDJSON / WebTransport / json-seq as default loader transport (worth benchmarking; not a swap on principle)
- Customized built-ins, Declarative Shadow DOM, `ElementInternals` (fight Preact's reconciler; Safari position)
- Sanitizer API (framework has no untrusted-HTML affordance)
- Speculation Rules prefetch/prerender for action/loader RPC (POST-only blocked by spec)
