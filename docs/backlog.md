# Backlog

Future work items that are out of scope for current POCs but should be addressed.

---

## Mutation Pattern

Deferred from the [mutation pattern POC](superpowers/specs/2026-04-23-mutation-pattern-design.md).

- **Cross-page cache invalidation** — `invalidate: string[]` to refetch loaders on other pages after a mutation, similar to Remix's revalidation system
- **Streaming action responses** — return a stream from `serverAction` for long-running operations (progress, chunked results)
- **File upload support** — handle `multipart/form-data` in `actionsHandler` and surface `File` objects in the action payload
- **Action guards** — middleware-style guards that run before an action, analogous to `serverGuards` for loaders (auth checks, rate limiting, etc.)
