---
name: keep-docs-fresh
description: Use when making code changes to framework packages, adding new API options or exports, renaming symbols, or changing documented behavior — docs must be updated in the same commit as the code.
---

# Keep Docs Fresh

**Docs and code ship together. There is no "update docs later."**

A commit that changes documented behavior without updating the docs is a broken commit. The code is wrong the moment the docs stop describing it accurately.

## When This Applies

- Adding a new option or prop to any public API (`getLoaderData`, `useAction`, `Form`, `createGuard`, etc.)
- Adding a new export to any `@hono-preact/*` package
- Renaming a function, type, option, or export
- Changing how something behaves (even "slightly")
- Adding a new feature that a developer would need to know about

## The Process

**Before committing any package change:**

1. **Identify what changed** — function name, option name, behavior, type
2. **Grep the docs for it:**
   ```bash
   grep -r "changedSymbol" apps/app/src/pages/docs/
   ```
3. **Update every doc that references the changed thing** — fix descriptions, update code examples, add new options to tables
4. **If the feature is new and has no doc coverage yet:**
   - Add it to the relevant existing page (new option → existing feature page)
   - OR create a new page via the `add-docs-page` skill if the feature warrants its own page
5. **Stage doc changes alongside code changes in the same commit**

## Docs Location

All user-facing docs live in:
```
apps/app/src/pages/docs/
```

Nav structure (6 sections) is in:
```
apps/app/src/pages/docs/nav.ts
```

Each MDX file maps to a route: `loaders.mdx` → `/docs/loaders`, etc.

## Red Flags — You Are About to Leave Docs Stale

These thoughts mean **stop, grep the docs first:**

| Thought | Reality |
|---|---|
| "Docs can be updated later" | Later never comes. Update them now. |
| "It's just a new option, obvious from the type" | Types are not docs. Examples and prose are docs. |
| "It's a small change" | Small changes to public API = big confusion for users. |
| "The feature isn't stable yet" | Unstable features still need docs. Add a note if needed. |
| "I'll do it in the next PR" | The next PR won't have context. Do it now. |

## What to Include in the Commit

Every commit that changes public API behavior must stage **at least one doc file** alongside the code files. If you can't point to a doc file in `apps/app/src/pages/docs/` that was updated, the commit is not ready.

**Exception:** Pure internal refactors that change no public API surface and are not referenced in any doc file. Verify with the grep above before claiming this exception.
