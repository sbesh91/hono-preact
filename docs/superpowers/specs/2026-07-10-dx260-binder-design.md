> DECISION (maintainer, revised 2026-07-10): Option A plus a diagnostic, superseding the earlier docs-only choice after an in-depth discussion of the layout/index aliasing limitation. Ship the wildcard binder serverRoute('<layout path>/*') as the layout-scope spelling: a distinct routeUse entry carrying the node's composed chain WITHOUT the index child's additions, also emitted for guard-only grouping nodes (making their prefixes bindable). Boot fails closed on wildcard misuse (a leaf path + '/*' is rejected). Add a dev warning when an exact layout-path binding's resolved chain differs from the layout node's own composed chain (the index child widened it), naming both spellings. The docs-only teaching from the earlier decision stays, revised to teach the two spellings: exact path = the page scope (deepest composed chain), path + '/*' = the subtree scope (layout chain). The site exemplar's layout loaders move to the wildcard spelling. All landing in PR #267.
> DECISION ADDENDUM (maintainer, 2026-07-11): strict wildcard typing via tree-form registration. New canonical registration idiom: interface RegisteredRoutes { tree: typeof routeTree }. A new public RouteSubtrees<M> walks the tree structurally (same Here/NextParent join as AbsolutePaths, nodes read structurally without RouteDef constraint to avoid the thunk cycle) and emits the subtree pattern for every children-bearing node, so the typed wildcard set equals the runtime collectRouteUse key set by construction: grouping prefixes typed, index-only layouts typed, leaf wildcards rejected at compile time. RegisteredPaths reads tree when present, falls back to the existing paths member (back-compat), then string. RegisteredSubtrees reads tree when present, falls back to the SubtreePatterns heuristic over registered paths, then never-with-string-permissiveness as today. Site, scaffolder template, and docs move to the tree form; the aliasing warning's typing clause simplifies to point at tree registration; the just-added grouping-prefix typing caveats in middleware.mdx/routes.mdx are revised accordingly. The derivation inherits the same root-layout join-quirk boundary as RoutePaths, unchanged.
> RESOLUTION ADDENDUM (2026-07-11): the root-layout join quirk is resolved; every walker now shares one join convention. Empirical pre-fix behavior: a root '/' node's children keyed as '//x' in collectRouteUse and collectServerRoutes while the types derived '/x' (slashed child) or bare 'x', so a serverRoute('/x') binding under a root layout was boot-REJECTED (fail-closed) by both assertRouteBindingsMatchMount and assertRegistryRouteBindingsValid; the only boot-passing spelling was the untypeable '//x'. No fail-open path existed through the generated server entry, though byPattern itself fails open on a key miss when wired without the boot checks. Fix: joinRoutePath (iso define-routes.tsx, mirrored in vite route-preload.ts) now applies the root reset itself, and the type-level Here gained the matching Parent-'/' branch (NextParent removed), so children of '/' key as '/x' (bare 'x' and slashed '/x' spellings both normalize), subtrees as '/x/*', the root's own subtree as '/*', and the empty-path index child folds into '/'. Flat registrations also moved from path + '/*' to subtreePatternOf, so a root layout registers '/*' instead of '//*'. Non-root trees are byte-identical (full iso/server/vite/site suites green). The "same Here/NextParent join" and "root-layout join-quirk boundary" phrases above describe the pre-resolution state.

# Design brief: subtree binder API (issue #260, finding 1, binder half)

All file references are to the read-only worktree at
`/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-binder`
(origin/main @ 93e480b6). Every claim about current behavior below was verified
against these files, not the issue text.

---

## 1. Problem statement

A loader's server-side `use` chain is composed as
`[appConfig.use, resolvePageUse(pattern), loader.use]`
(`packages/server/src/loaders-handler.ts:288-317`). The page tier, which is
where route/layout auth gates live, is attached only when the loader is
route-bound: `routeBound = typeof entry.routeId === 'string'`
(`loaders-handler.ts:294`), and bare `defineLoader` gets `EMPTY_PAGE_USE`
(`loaders-handler.ts:180-183`, spread at `:312`).

The structural case in the site: `apps/site/src/routes.ts:34-55` gates the
projects subtree with `use: requireSession` on the `projects` layout node, but
the layout's own loaders are bare (`apps/site/src/pages/demo/projects-shell.server.ts:39-49`,
`default:` and `activity:` both plain `defineLoader`). The `POST /__loaders`
RPC for shell data therefore composes no page tier. PR #263 added the dev-only
warning for exactly this (`loaders-handler.ts:193-208` and the
`findGuardedRoute` wiring at `:295-305`, matcher built by
`makeGuardedRouteMatcher`, `packages/server/src/route-server-modules.ts:63-73`).
The warning tells the author to bind; this brief designs the binding API.

**Security ground rule (from the withdrawn v0.10 P0):** guard resolution must
come from the binder's own DECLARATION, resolved server-side at boot/request
time by exact pattern key, never from the client-sent `location.path`. That is
already the codebase invariant: `makePageUseResolver` deliberately exposes only
`byPattern` (exact key lookup) and documents why `byPath` was removed
(`route-server-modules.ts:24-45`); the URL fuzzy-match survives only in the
observational dev warning. Every option below keeps guard resolution static
(declaration-time pattern, boot-validated).

### A finding the issue got partially wrong (verified)

Issue #260 says a layout "spans multiple child routes so there is no single
pattern for `serverRoute()`." That premise does not hold for layout nodes that
carry a server module (which auto-discovery gives every colocated
`*.server.ts`). Today, `serverRoute('/demo/projects')` in
`projects-shell.server.ts` works end to end:

1. **Typing.** `RegisteredPaths` includes layout node paths: `NodePaths` emits
   the joined path for any node with a `layout` key
   (`packages/iso/src/internal/typed-routes.ts:18-31`, line 25). The site
   registers `RoutePaths<typeof routeTree>` (`apps/site/src/routes.ts:66-70`),
   so `/demo/projects` autocompletes in `serverRoute`
   (`packages/iso/src/server-route.ts:179-181`).
2. **Guard resolution.** `collectRouteUse` emits an entry for every node with
   `view || server` (`packages/iso/src/define-routes.tsx:286-318`, line 305),
   so the layout node yields `{ path: '/demo/projects', use: [requireSession] }`
   with ancestor use folded outer-first (`composeUse`, `:148-150`).
   `makePageUseResolver(...).byPattern('/demo/projects')` resolves it exactly.
3. **Boot validation.** `assertRouteBindingsMatchMount` requires
   `__routeId === route.path` (`packages/server/src/route-binding-guard.ts:46-72`);
   `collectServerRoutes` mounts the shell module at `/demo/projects`
   (`define-routes.tsx:246-284`), so the assertion passes.
4. **Params/location.** The layout's RPC location is the derived layout
   location, wildcard and child params stripped (`deriveLayoutLocation`,
   `define-routes.tsx:464-494`; provider installed at `:434-438`), which
   matches `RouteParams<'/demo/projects'>` = `{}`.
5. **Warning interaction.** Binding sets `entry.routeId`, so `routeBound` is
   true and the #263 warning path is skipped (`loaders-handler.ts:294-305`).
6. **Build plugin.** The Vite parser flags any non-computed `.loader(...)`
   member call as route-bound (`packages/vite/src/server-loaders-parser.ts:25-36,84`),
   so no plugin change is needed for any member-call binder spelling.

So the real remaining gaps are narrower than "no API exists":

- **(G1) Pattern-key aliasing.** The layout node and its index child (`path: ''`)
  share the pattern string `/demo/projects`; `collectRouteUse` dedups
  deepest-wins (`define-routes.tsx:312-317`), so `byPattern('/demo/projects')`
  returns the INDEX CHILD's composed chain. Today that is a superset of the
  layout's chain (child = inherited + own), so the failure direction is
  over-guarding, not under-guarding, but a layout binder that means "this
  subtree" is semantically aliased to "the index page."
- **(G2) Intent is not expressible.** `serverRoute('/demo/projects')` reads as
  "the index route," not "the subtree this layout spans." Nothing in the type
  system or the spelling says "bind me to the gates every descendant inherits."
- **(G3) Guard-only grouping prefixes are unbindable.** A bare grouping node
  (`children` + `use`, no `layout`/`view`) produces no `routeUse` entry
  (`define-routes.tsx:305` requires `r.view || r.server`) and no
  `RegisteredPaths` member (`typed-routes.ts:24-25` emit only view/layout
  nodes). A `src/server` registry unit cannot bind to that prefix at all.
- **(G4) Discoverability.** The #263 warning suggests
  `serverRoute('<matched pattern>')` (`loaders-handler.ts:200-207`); for a
  layout-location request it suggests the aliased bare pattern from G1.

## 2. Mechanism today (summary, code-referenced)

- Chain composition: `composeServerChainOrFailClosed` with
  `resolvePageUse: routeBound ? byPattern : EMPTY_PAGE_USE` and
  `path: routeBound ? entry.routeId : ''` (`loaders-handler.ts:306-317`;
  chain order documented in `packages/server/src/compose-server-chain.ts:42-58`).
- `byPattern` is an exact `Map` lookup over `manifest.routeUse` and **fails
  open** (returns `[]`) on a key miss (`route-server-modules.ts:36-45`). The
  fail-closed layer is at boot: `assertRouteBindingsMatchMount` for colocated
  modules and `assertRegistryRouteBindingsValid` against
  `validRoutePatterns = new Set(routes.routeUse.map(r => r.path))` for
  registry modules (`route-binding-guard.ts:46-121`,
  `packages/server/src/create-server-entry.ts:137-150`).
- Pattern grammar: `urlPathMatchesPattern` already understands `*` as
  "entire remainder, including none" (`packages/server/src/route-pattern.ts:22-55`),
  and the framework's own flat registration already registers every layout
  group at BOTH `path` and `path + '/*'` (`define-routes.tsx:590-598, 623-627`).
  `RouteParams` extracts only `:name` params, so a trailing bare `/*`
  contributes no param (`typed-routes.ts:104-109`): `RouteParams<'/a/:org/*'>`
  is `{ org: string }`.
- `_defineRouteLoader` stamps `__routeId` into the ref
  (`packages/iso/src/define-loader.ts:453-478`); `buildLoadersMap` copies it to
  `entry.routeId` (`loaders-handler.ts:79-95`).
- Client side: `LoaderHost` resolves the loader's location from
  `RouteLocationsContext` by moduleKey and refuses a route-bound loader with no
  resolvable location (`packages/iso/src/internal/loader.tsx:103-132`). This is
  independent of the `__routeId` string, so no client change is needed for any
  option.

## 3. Options

### Option A: wildcard pattern on the existing binder, `serverRoute('/demo/projects/*')`

**Proposed signature** (`packages/iso/src/server-route.ts`):

```ts
export function serverRoute<
  const RouteId extends RegisteredPaths | RegisteredSubtrees,
>(route: RouteId): RouteBinder<RouteId>;
```

with a new derived type in `packages/iso/src/internal/typed-routes.ts`:

```ts
// `${P}/*` for every registered path P that has a registered descendant.
// Derived from the paths union itself: no new module-augmentation key, so
// existing `RegisteredRoutes` registrations gain subtree patterns with no
// user action, and buildPath/useParams (which stay on RegisteredPaths) see
// no new members.
type SubtreeFrom<P extends string, All extends string> = [
  Extract<All, `${P}/${string}`>,
] extends [never]
  ? never
  : `${P}/*`;

export type RegisteredSubtrees = RegisteredPaths extends infer All extends
  string
  ? All extends string
    ? SubtreeFrom<All, RegisteredPaths>
    : never
  : never;
```

`RouteBinder<RouteId>` is unchanged; `RouteParams<'/demo/projects/*'>` is `{}`
and `RouteParams<'/demo/projects/:projectId/*'>` is `{ projectId: string }`,
i.e. exactly the prefix params, matching the derived layout location the
loader actually receives at runtime (`deriveLayoutLocation` strips the
wildcard remainder and the `rest`/`0` keys, `define-routes.tsx:469-488`).

**Semantics.** `'/x/*'` names ONE tree node (the node at `/x`) and resolves,
statically at declaration time, the `use` chain every descendant of that node
inherits: ancestors outer-first, then the node's own `use`. There is no
per-request "deepest matching node" resolution; that would be URL-driven guard
selection, which is exactly the withdrawn-P0 footgun this codebase removed
(`route-server-modules.ts:28-31`). Deeper nodes' own `use` is intentionally
not included: a subtree binder means "at least the subtree's gates," and a
unit that needs a deeper node's gates binds that node's pattern.

**Runtime changes:**

1. `collectRouteUse` (`define-routes.tsx:286-318`): for every node with
   `children`, additionally emit `{ path: here + '/*', use: composed }`. This
   covers layout groups AND bare grouping nodes (closing G3 at runtime), and
   gives the subtree its own map key distinct from the index child (closing
   G1: the layout binder no longer reads the index child's deduped entry).
2. `assertRouteBindingsMatchMount` (`route-binding-guard.ts:46-72`): accept
   `__routeId === route.path` OR
   (`__routeId === route.path + '/*'` AND the pattern is in
   `validRoutePatterns`). The second conjunct matters: a leaf module binding
   `'/leaf/*'` must fail at boot, because no `routeUse` key would exist and
   `byPattern` fails open. Thread `validRoutePatterns` into the assert from
   `create-server-entry.ts:137-141` (it is already computed there).
3. `assertRegistryRouteBindingsValid` needs no change: `validRoutePatterns`
   now contains the wildcard keys, so a registry unit bound to a real subtree
   passes and a typo fails loudly (`route-binding-guard.ts:93-121`).
4. No change to `loaders-handler.ts` dispatch: `entry.routeId` is
   `'/demo/projects/*'`, `byPattern` hits the new key, `routeBound` is true so
   the #263 warning is silenced automatically (`loaders-handler.ts:294-305`).
5. No Vite plugin change (`server-loaders-parser.ts:25-36` matches the member
   call form already).

**Edge behaviors (as asked):**

- *Params typing:* only the bound prefix's params are typed (see above);
  a layout spans children with different params and never sees them, matching
  today's runtime (`deriveLayoutLocation`).
- *Pattern matches no node:* boot error, never request-time. Colocated module:
  extended mount assert. Registry module: `assertRegistryRouteBindingsValid`
  against the widened `validRoutePatterns`. Dev mode re-runs boot checks per
  request (`create-server-entry.ts:143-150`), so adding the file mid-session
  also fails loudly.
- *#263 warning:* silenced by binding (routeBound short-circuit). Bonus: with
  wildcard keys in `routeUse`, `findBestPattern` over the matcher's keys picks
  `'/demo/projects/*'` (score ties at 4, depth 3 beats 2:
  `route-pattern.ts:84-102`) for a layout-location request, so the warning's
  suggested spelling becomes the wildcard for layout loaders while leaf
  requests still suggest the exact leaf pattern (higher literal score). The
  message template at `loaders-handler.ts:200-207` needs no text change.
- *Known aliasing remainder:* a literal `path: '*'` child (e.g. the site's
  `/docs` catch-all, `routes.ts:23`) produces the same string `'/docs/*'` as
  the layout's subtree key; deepest-wins dedup keeps the child's chain, which
  is a superset (inherited + own), so the failure direction stays
  over-guarding. Document it in the `routeUse` doc comment
  (`define-routes.tsx:101-109`).

**Before/after (real site code, `projects-shell.server.ts:39-49`):**

```ts
// before
export const serverLoaders = {
  default: defineLoader(async (ctx) => {
    const user = await currentUser(ctx.c);
    ...
  }),
  activity: defineLoader(activityStream, { live: true }),
};

// after
const route = serverRoute('/demo/projects/*');
export const serverLoaders = {
  default: route.loader(async (ctx) => {
    const user = await currentUser(ctx.c);
    ...
  }),
  activity: route.loader(activityStream, { live: true }),
};
```

(The standalone `activityStream` helper keeps its `LoaderCtx` annotation only
if left un-narrowed; simplest is dropping the explicit annotation and letting
the binder's contextual type flow, as `route.loader` overloads are written to
do, `server-route.ts:80-105`.)

**Files changed:** `packages/iso/src/internal/typed-routes.ts`,
`packages/iso/src/server-route.ts`, `packages/iso/src/define-routes.tsx`,
`packages/server/src/route-binding-guard.ts`,
`packages/server/src/create-server-entry.ts`, tests alongside each, site
usage, docs.

### Option B: dedicated `serverLayout(path)` binder

**Proposed signature** (new export from `packages/iso/src/server-route.ts`):

```ts
/**
 * Bind a server module to a layout/grouping node's SUBTREE: loaders/actions
 * defined through the returned binder resolve the `use` chain every
 * descendant of `path` inherits (ancestors outer-first, then the node's own
 * `use`). Equivalent to serverRoute(`${path}/*`) with the wildcard applied
 * for you.
 */
export function serverLayout<const RouteId extends RegisteredPaths>(
  path: RouteId
): RouteBinder<RouteId>;
```

Implementation is a two-line wrapper that stamps
`__routeId = path + '/*'` (via the same `_defineRouteLoader` /
`_defineRouteAction` calls, `server-route.ts:183-191`) and therefore requires
ALL of Option A's runtime changes (wildcard `routeUse` entries, mount-assert
extension, registry validation already covered). What it saves is the type
work: no `RegisteredSubtrees` derivation, since the argument is the plain
registered layout path (already in the union, `typed-routes.ts:25`) and
`RouteParams<RouteId>` types the prefix params directly.

**Edge behaviors:** identical to Option A (same `__routeId`, same boot
validation, same warning silencing), plus one extra failure class: a leaf path
argument (`serverLayout('/demo/login')`) typechecks (any registered path is
accepted; the type system cannot distinguish layout from view paths without a
new `LayoutPaths<T>` tree walker) and fails at boot because `'/demo/login/*'`
is not in `routeUse`. Restricting the type to layout paths would require a
second type extractor and, to cover grouping-only prefixes, a registration
change; per YAGNI that is not bundled in.

**Before/after:** as Option A but
`const route = serverLayout('/demo/projects');`.

**Files changed:** same as Option A minus `typed-routes.ts`, plus the new
export and its `index.ts` barrel entry, plus docs for a second binder.

### Option C: no new API; document the existing spelling and harden its edges

Ship only: (1) docs teaching `serverRoute('<layout pattern>')` for layout
modules (verified working today, section 1); (2) a `routeUse` doc-comment and
docs note about the index-child aliasing (G1, over-guarding direction);
(3) leave G3 with the documented workaround: a registry unit shared across a
gated subtree binds ANY descendant leaf's exact pattern and runs under that
leaf's chain, which is a superset of the subtree chain, so the gate is never
weaker than intended.

**Edge behaviors:** all current behavior, no code change. The #263 warning
already suggests exactly this spelling for layout-location requests
(`loaders-handler.ts:200-207` interpolates the best-match pattern, which is
`/demo/projects` today).

**Files changed:** docs only (`apps/site/src/pages/docs/loaders.mdx`,
`middleware.mdx`), site demo swap to `serverRoute('/demo/projects')`.

## 4. Tradeoff table

| | A: `serverRoute('/x/*')` | B: `serverLayout('/x')` | C: docs only |
|---|---|---|---|
| Closes G1 (index-child aliasing) | Yes (own map key) | Yes (same key) | No (documented) |
| Closes G2 (subtree intent expressible) | Yes, in the pattern language | Yes, in the function name | No |
| Closes G3 (grouping-only prefixes) | Runtime yes; typed only when prefix has registered descendants and is itself registered | Runtime yes; same typing hole | No (superset workaround) |
| New public API surface | 0 functions (widened param type) | 1 function | 0 |
| Type machinery | `RegisteredSubtrees` derivation (small, no registration change) | none | none |
| Matches existing conventions | High: `*` is already the framework's own subtree spelling (flat registration `path` + `path/*`, `define-routes.tsx:590-598`; matcher grammar `route-pattern.ts:13-16`) | Medium: new name, same `RouteBinder` shape | n/a |
| Misuse failure mode | Boot error (`'/leaf/*'` rejected; typo rejected) | Boot error, but leaf-path argument typechecks first | Silent semantic muddiness (G1) |
| "Which API do I use?" cost | None (one binder) | Real: two binders whose runtime differs only by a `/*` | None |
| #263 warning suggestion | Becomes the wildcard for layout requests automatically | Needs message special-casing to suggest `serverLayout` | Already correct |
| Docs cost | One section in loaders.mdx + middleware.mdx | Same, plus a second API reference entry | Smallest |

## 5. Recommendation

**Option A.** The runtime work is identical between A and B (B is A with the
`/*` hidden), so the choice is purely surface, and A wins on convention: `*`
is already this framework's canonical "this node and everything under it"
spelling, both in the matcher grammar the server ships
(`route-pattern.ts:13-16`) and in the framework's own dual registration of
every layout group at `path` and `path/*`. One binder with one pattern
language keeps the mental model "bind the pattern you can read in routes.ts";
a second `serverLayout` function would exist only to save four characters
while adding a which-one question and a docs page. The `RegisteredSubtrees`
derivation is small, adds nothing to `buildPath`/`useParams` autocompletion
(they stay on `RegisteredPaths`, `build-path.ts:24`, `use-params.ts:15`), and
requires no change to existing user route registrations. Guard resolution
stays declaration-time and boot-validated, honoring the server-authoritative
rule; the only URL-driven piece remains the observational dev warning, which
this design makes suggest the correct wildcard spelling for layout loaders for
free. Option C is defensible on pure YAGNI (the site's case works today), but
it leaves the layout binding aliased to the index child's chain and leaves
subtree intent unwritable, which is precisely the ergonomic gap finding 1
names.

## 6. Breaking-change and docs impact

**Breaking: none.** All changes are additive:

- New `routeUse` wildcard entries add map keys; existing exact keys and their
  chains are unchanged (dedup order untouched for non-`/*` keys).
- `serverRoute`'s parameter type widens (accepts strictly more literals).
- `assertRouteBindingsMatchMount` accepts strictly more bindings.
- Behavior shift worth a release-note line (not breaking): in dev, the #263
  warning's suggested pattern for a layout-location request changes from the
  bare layout path to the wildcard form, because `findBestPattern` now sees
  the deeper wildcard key. Purely diagnostic text.
- `RegisteredSubtrees` is a new exported type; nothing existing renames.

**Docs:** `loaders.mdx` (route-bound loaders section: add the layout/subtree
case with the wildcard spelling), `middleware.mdx` (page-layer `use`: state
that subtree gates reach RPCs only through binding, and show the binder),
`apps/site/src/pages/demo/projects-shell.server.ts` swapped to the bound form
(it is the live demo the finding cites). Per the docs policy, describe what
is; no "formerly bare loaders" breadcrumbs. The scaffolder's `add-a-guard` /
`add-a-loader` recipes (issue #260 finding 2's territory) should mention the
wildcard binder when that template refresh happens; not bundled here.

## 7. Testing strategy

Honors the repo's verification constraints: type-level assertions go in
`*.test-d.ts` (run by `pnpm test:types`, which reads dist, so the framework
build must precede it), shared-type changes must also pass `pnpm typecheck`,
and the full pre-push sequence in CLAUDE.md applies (build, gen:agents-corpus,
format:check, typecheck, test:types, test:coverage, test:integration, site
build).

1. **`collectRouteUse` unit tests** (extend the existing define-routes suite,
   `packages/iso/src/__tests__/`): a layout node with `use` yields a
   `'/x/*'` entry carrying inherited + own chain; a bare grouping node with
   `use` yields its `'/x/*'` entry (G3); a literal `path: '*'` child
   deepest-wins over the layout's subtree key; the pre-existing exact-key
   entries are byte-identical to before (regression pin).
2. **`route-binding-guard` unit tests**
   (`packages/server/src/__tests__/`): `__routeId === route.path + '/*'`
   passes when the wildcard is a valid pattern; a leaf module binding
   `'/leaf/*'` throws at boot; registry unit bound to `'/x/*'` passes iff the
   key exists.
3. **`loadersHandler` integration** (extend
   `packages/server/src/__tests__/boundary.test.ts` /
   `page-use-resolver.test.ts` style): a wildcard-bound loader's RPC runs the
   subtree chain (spy middleware records execution and order app -> page ->
   unit); a deny() in the subtree chain blocks the RPC (the actual security
   property); the #263 warning does NOT fire for the bound loader and still
   fires for a bare sibling.
4. **Type-level** (`*.test-d.ts`): `serverRoute('/demo/projects/*')` accepted
   under a registered tree; `serverRoute('/nope/*')` rejected;
   `ctx.location.pathParams` for `'/a/:org/*'` is exactly `{ org: string }`
   (no child params leak); `buildPath` still rejects `'/demo/projects/*'`
   (nav surface unpolluted).
5. **Site as end-to-end fixture:** after swapping
   `projects-shell.server.ts` to the bound form, `pnpm --filter site build`
   plus the existing demo flow (unauthenticated `POST /__loaders` for shell
   data must now be denied by `requireSession` instead of returning data);
   verify against the running dev server AND the built worker per the
   "verify URL reachable, not just emitted" rule.
6. **Warning-text snapshot:** dev-mode request at a layout location asserts
   the suggested pattern is now the wildcard (pins the `findBestPattern`
   depth-tiebreak behavior this design relies on).
