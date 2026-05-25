# Web standards adoption: roadmap

A multi-spec wave bringing the framework onto web-standard APIs where the platform now offers what we were building ourselves. Each spec is independently shippable on `main`. `v0.3.0` cuts once A, C, and E have landed (with `create-hono-preact@0.3.0` lockstep). B is deferred to a later release; D was shelved during brainstorming.

| Spec | Scope | Status |
|---|---|---|
| **A** | Platform hygiene: `AbortSignal` timeouts, `useOptimistic` View Transitions, `URL.parse`, TransformStream SSE codec | merged 2026-05-23 (PRs #56, #58) |
| **B** | Navigation API as primary intercept, with `preact-iso` fallback | deferred — waiting on first-class Navigation API support in `preact-iso` upstream; framework will adopt via opt-in when it lands |
| **C** | Progressive-enhancement forms + `/__actions` envelope reshape | merged 2026-05-24 (PR #59) |
| **D** | Streaming SSR upgrade via `preact-render-to-string` `renderToReadableStream` | shelved 2026-05-24 — Suspense-streamed body offered the same capability the existing async-generator loader streaming already covers (multi-yield generators with a sentinel first yield). The DX gap (boilerplate to wrap a one-shot async loader as a generator) is narrower than the trade-offs streaming SSR introduces: late-outcome handling (redirect/deny from a suspended boundary cannot become an HTTP redirect once headers are flushed), JS-dependent SEO for content that streams in via `<div hidden>` swap scripts, and two render paths to maintain. Document the generator-with-sentinel pattern in `apps/site` docs instead. |
| **E** | Speculation Rules `<script>` emitter for first-load prefetch | spec drafted 2026-05-24 (opt-in via `defineApp({ speculation: true })`); implementation pending |

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
