// hono-preact/server/internal/cloudflare: umbrella re-export of the Cloudflare-only
// server door. Kept SEPARATE from server/internal/runtime because the underlying
// module value-imports `cloudflare:workers`, which resolves only in workerd; the
// Node generated entry must never load this door. Only the Cloudflare adapter's
// generated worker entry imports it. Framework-private, co-versioned with the
// codegen that emits it.
export * from '@hono-preact/server/internal/cloudflare';
