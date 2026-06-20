# Realtime PR 1: Typed channel substrate (`defineChannel`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strictly-typed channel address (`defineChannel`) that turns a `/:param` name + a payload type into a branded `Topic<Payload>`, the `serverRoute`/`buildPath` analog for realtime.

**Architecture:** A pure-type module plus a small shared pattern interpolator in `packages/iso`. The `:param` substitution is extracted into one shared internal helper that both `build-path.ts` (route paths) and the new `define-channel.ts` (channel topics) consume, so they interpolate identically and the logic is not duplicated. Channel names reuse the existing route param-extraction type (`RouteParams`) so a channel name's `:params` are typed by the same engine that types route params. The payload type rides a phantom brand on the returned topic string so later layers (publish/subscribe, live loaders, rooms in PRs 2-4) infer the payload from one source and cannot drift. This PR is the first of a 5-PR program (see `docs/superpowers/specs/2026-06-20-first-class-realtime-design.md`); PRs 2-5 get their own plans.

**Tech Stack:** TypeScript (template-literal types), Vitest (`vitest run` for runtime tests, `vitest run --typecheck.only` for `*.test-d.ts` type tests).

## Global Constraints

- **No em-dashes** in prose, code comments, or commit messages. Use a comma, semicolon, colon, parentheses, or two sentences.
- **DRY the interpolation.** The `:param` substitution lives in exactly ONE place, `packages/iso/src/internal/interpolate-pattern.ts`, consumed by both `build-path.ts` and `define-channel.ts`. Do not duplicate the substitution block.
- **Casts are a smell; reshape instead.** This work has exactly ONE sanctioned cast: the phantom-brand assertion in `Channel.key` (a nominal `Topic` brand cannot be produced without an assertion). No other `as` is permitted in either new file or the build-path refactor.
- **Reuse, do not reimplement, `RouteParams`** from `packages/iso/src/internal/typed-routes.ts`. Channel names use the route `/:param` grammar precisely so this engine applies unchanged.
- **PR 1 stays module-internal.** Do NOT add `defineChannel`/`Channel`/`Topic` to the public barrel `packages/iso/src/index.ts`; that (plus docs) lands in PR 2 when `publish`/`subscribe` make it usable, avoiding the llms export-coverage gate churn for an unusable API.
- **Behavior parity on the refactor.** `buildPath`'s observable behavior must not change; `packages/iso/src/__tests__/build-path.test.ts` must stay green untouched.
- **Node engine floor** is `^22.18.0 || >=24.11.0` (Babel 8 bump). An "Unsupported engine" WARN on Node 24.10 is expected and not fatal.
- **Pre-merge gate** (run before opening the PR), mirroring `.github/workflows/ci.yml` in order: build framework dist, `pnpm format:check`, `pnpm typecheck`, `pnpm test:types`, `pnpm test:coverage`. (No `.server`, site, or integration surface is touched by this PR.)
- Commits land on the current worktree branch `worktree-first-class-realtime` (the spec doc already committed there).

---

### Task 1: Extract the shared `interpolatePattern` helper

**Files:**
- Create: `packages/iso/src/internal/interpolate-pattern.ts`
- Modify: `packages/iso/src/build-path.ts` (replace the inline substitution body with a call to the helper)
- Test: `packages/iso/src/__tests__/interpolate-pattern.test.ts`
- Regression (must stay green, do not edit): `packages/iso/src/__tests__/build-path.test.ts`

**Interfaces:**
- Produces: `function interpolatePattern(pattern: string, values: Record<string, string | undefined>): string` exported from `packages/iso/src/internal/interpolate-pattern.ts`.

- [ ] **Step 1: Write the failing helper test**

Create `packages/iso/src/__tests__/interpolate-pattern.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpolatePattern } from '../internal/interpolate-pattern.js';

describe('interpolatePattern', () => {
  it('substitutes a single :param', () => {
    expect(interpolatePattern('board/:projectId', { projectId: 'p1' })).toBe(
      'board/p1'
    );
  });

  it('substitutes multiple :params', () => {
    expect(
      interpolatePattern('room/:roomId/user/:userId', {
        roomId: 'r1',
        userId: 'u9',
      })
    ).toBe('room/r1/user/u9');
  });

  it('keeps static segments verbatim', () => {
    expect(interpolatePattern('activity', {})).toBe('activity');
  });

  it('url-encodes values', () => {
    expect(interpolatePattern('board/:projectId', { projectId: 'a/b c' })).toBe(
      'board/a%2Fb%20c'
    );
  });

  it('drops an absent optional segment', () => {
    expect(interpolatePattern('a/:b?', {})).toBe('a');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/interpolate-pattern.test.ts`
Expected: FAIL, cannot resolve `../internal/interpolate-pattern.js`.

- [ ] **Step 3: Create the helper**

Create `packages/iso/src/internal/interpolate-pattern.ts`:

```ts
// Substitute `:param` segments in a `/`-delimited pattern with their values.
// Shared by `build-path.ts` (route paths) and `define-channel.ts` (channel
// topics) so both interpolate identically: the same `[A-Za-z0-9_]` name class,
// the same single optional `?*+` modifier, the same drop-absent-segment and
// url-encode rules. The runtime matcher (preact-iso's `exec`) only treats
// `:name` (name in `[A-Za-z0-9_]+`, optional trailing `?`/`*`/`+`) as a param;
// anything else is a literal segment kept verbatim.
export function interpolatePattern(
  pattern: string,
  values: Record<string, string | undefined>
): string {
  return pattern
    .split('/')
    .map((seg) => {
      const m = /^:([A-Za-z0-9_]+)[?*+]?$/.exec(seg);
      if (!m) return seg; // static segment, kept verbatim
      const value = values[m[1]];
      // Absent or empty -> drop the segment. A non-optional param is required by
      // the caller's type, so a missing value here can only be an optional one;
      // an empty string is treated the same to avoid emitting `//`.
      return !value ? null : encodeURIComponent(value);
    })
    .filter((seg): seg is string => seg !== null)
    .join('/');
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/interpolate-pattern.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor `build-path.ts` to use the helper**

In `packages/iso/src/build-path.ts`, add the import at the top (after the existing `RouteParams` import):

```ts
import { interpolatePattern } from './internal/interpolate-pattern.js';
```

Replace the implementation body (the `const values = params ?? {}; return pattern.split('/')...join('/');` block) so the implementation function reads:

```ts
export function buildPath(
  pattern: string,
  params?: Record<string, string | undefined>
): string {
  return interpolatePattern(pattern, params ?? {});
}
```

Leave the public typed overload (`export function buildPath<P extends RegisteredPaths>(...)`) and the file's doc comment unchanged.

- [ ] **Step 6: Run the build-path regression test to verify parity**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/build-path.test.ts`
Expected: PASS, unchanged (the refactor is behavior-preserving).

- [ ] **Step 7: Format, then commit**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/internal/interpolate-pattern.ts packages/iso/src/__tests__/interpolate-pattern.test.ts packages/iso/src/build-path.ts
git commit -m "refactor(iso): extract shared interpolatePattern helper for build-path

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `defineChannel` factory + branded `Topic` + runtime/type tests

**Files:**
- Create: `packages/iso/src/define-channel.ts`
- Test: `packages/iso/src/__tests__/define-channel.test.ts`
- Test: `packages/iso/src/__tests__/define-channel.test-d.ts`

**Interfaces:**
- Consumes: `RouteParams<Path>` from `packages/iso/src/internal/typed-routes.ts`; `interpolatePattern` from `packages/iso/src/internal/interpolate-pattern.ts` (Task 1).
- Produces:
  - `type Topic<Payload>` — a branded string carrying `Payload` (phantom).
  - `interface Channel<Name extends string, Payload>` with `readonly name: Name` and `key(...args: KeyArgs<RouteParams<Name>>): Topic<Payload>`.
  - `function defineChannel<const Name extends string>(name: Name): <Payload = void>() => Channel<Name, Payload>`.

- [ ] **Step 1: Write the failing runtime test**

Create `packages/iso/src/__tests__/define-channel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineChannel } from '../define-channel.js';

describe('defineChannel.key', () => {
  it('substitutes a single :param', () => {
    const c = defineChannel('board/:projectId')<{ x: number }>();
    expect(c.key({ projectId: 'p1' })).toBe('board/p1');
  });

  it('substitutes multiple :params', () => {
    const c = defineChannel('room/:roomId/user/:userId')();
    expect(c.key({ roomId: 'r1', userId: 'u9' })).toBe('room/r1/user/u9');
  });

  it('returns the bare name for a param-less channel', () => {
    const c = defineChannel('activity')<number>();
    expect(c.key()).toBe('activity');
  });

  it('url-encodes param values', () => {
    const c = defineChannel('board/:projectId')();
    expect(c.key({ projectId: 'a/b c' })).toBe('board/a%2Fb%20c');
  });

  it('exposes the channel name', () => {
    expect(defineChannel('board/:projectId')().name).toBe('board/:projectId');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-channel.test.ts`
Expected: FAIL, cannot resolve `../define-channel.js`.

- [ ] **Step 3: Implement the module**

Create `packages/iso/src/define-channel.ts`:

```ts
import type { RouteParams } from './internal/typed-routes.js';
import { interpolatePattern } from './internal/interpolate-pattern.js';

// A topic string branded with its payload type. The brand is phantom (a
// `unique symbol` optional key, never present at runtime); it lets the later
// publish/subscribe layer infer the payload from a topic and reject a raw,
// unbranded string. The string-to-topic relationship mirrors how `buildPath`
// produces a path from a typed pattern, but the value also carries the payload.
declare const TopicPayload: unique symbol;
export type Topic<Payload> = string & { readonly [TopicPayload]?: Payload };

// No argument for a param-less name; the params object for a `:param` name.
// Mirrors `build-path.ts`'s `BuildArgs`.
type KeyArgs<P> = keyof P extends never ? [] : [params: P];

/**
 * A strictly-typed channel address: a `/:param` name plus a payload type. The
 * `serverRoute`/`buildPath` analog for realtime channels. `key(params)` builds a
 * branded `Topic<Payload>`; the payload type rides the brand so later layers
 * (publish/subscribe, live loaders, rooms) infer it from one source.
 */
export interface Channel<Name extends string, Payload> {
  readonly name: Name;
  key(...args: KeyArgs<RouteParams<Name>>): Topic<Payload>;
}

/**
 * Define a typed channel. The name uses the route `/:param` grammar, so its
 * params are extracted by the same engine that types route params:
 *
 * ```ts
 * const boardChannel = defineChannel('board/:projectId')<{ taskId: string }>();
 * boardChannel.key({ projectId: 'p1' }); // Topic<{ taskId: string }> ('board/p1')
 * ```
 *
 * Curried so the name is inferred while the payload is given explicitly. A
 * payload-less channel (`defineChannel('x')()`) is a signal channel (`void`).
 */
export function defineChannel<const Name extends string>(name: Name) {
  return <Payload = void>(): Channel<Name, Payload> => ({
    name,
    // The `key` impl is intentionally loose (a `Record` in, a `string` out); the
    // strict params and branded `Topic` return are supplied by the `Channel`
    // type. This single assertion is the one sanctioned brand boundary.
    key: ((params?: Record<string, string | undefined>) =>
      interpolatePattern(name, params ?? {})) as Channel<Name, Payload>['key'],
  });
}
```

- [ ] **Step 4: Run the runtime test to verify it passes**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-channel.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the type-level contract test**

Create `packages/iso/src/__tests__/define-channel.test-d.ts`:

```ts
// Type-level contract for defineChannel. Run under `pnpm test:types`. Proves the
// channel name's `:params` are typed (via the reused RouteParams engine), the
// payload rides the Topic brand, and misuse is a compile error.
import { expectTypeOf } from 'vitest';
import { defineChannel, type Topic } from '../define-channel.js';

function _probes() {
  const board = defineChannel('board/:projectId')<{
    taskId: string;
    to: string;
  }>();

  // key() requires the typed params and yields a Topic carrying the payload.
  const t = board.key({ projectId: 'p1' });
  expectTypeOf(t).toEqualTypeOf<Topic<{ taskId: string; to: string }>>();

  // @ts-expect-error missing required param
  board.key({});
  // @ts-expect-error wrong param name
  board.key({ project: 'p1' });
  // @ts-expect-error a param object is required
  board.key();

  // Multiple params: each is required and typed. RouteParams yields an
  // intersection (`{roomId} & {userId}`), so the params shape is pinned
  // behaviorally (omitting either param is an error) rather than by a strict
  // toEqualTypeOf against a merged object, which the intersection would fail.
  // The missing-param errors also catch a regression that widened the params to
  // a looser type such as Record<string, string>.
  const room = defineChannel('room/:roomId/user/:userId')<number>();
  expectTypeOf(room.key({ roomId: 'r1', userId: 'u9' })).toEqualTypeOf<
    Topic<number>
  >();
  // @ts-expect-error missing userId
  room.key({ roomId: 'r1' });
  // @ts-expect-error missing roomId
  room.key({ userId: 'u9' });

  // A param-less channel: key() takes no argument.
  const activity = defineChannel('activity')<string>();
  expectTypeOf(activity.key()).toEqualTypeOf<Topic<string>>();
  // @ts-expect-error a param-less channel takes no argument
  activity.key({ nope: 'x' });

  // A payload-less (signal) channel defaults to Topic<void>.
  const ping = defineChannel('ping/:id')();
  expectTypeOf(ping.key({ id: '1' })).toEqualTypeOf<Topic<void>>();
}

// Mark the type-only probe as used (the repo convention; a bare unused function
// trips noUnusedLocals under the type-test tsconfig). Mirrors define-loader-live.
void _probes;
```

- [ ] **Step 6: Run the type tests to verify they pass**

Run (from the worktree ROOT with the full path; the `--filter`-package form finds no files because the vitest config globs are root-relative): `pnpm exec vitest run --typecheck.only packages/iso/src/__tests__/define-channel.test-d.ts`
Expected: `Test Files 1 passed`, `Type Errors no errors`. If a `@ts-expect-error` is reported "unused", the corresponding misuse is wrongly accepted, fix the type in `define-channel.ts` (do not delete the assertion). If a positive `expectTypeOf` fails, the params/payload typing is wrong.

- [ ] **Step 7: Format, then commit**

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/define-channel.ts packages/iso/src/__tests__/define-channel.test.ts packages/iso/src/__tests__/define-channel.test-d.ts
git commit -m "feat(iso): defineChannel typed channel address + branded Topic

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pre-merge gate (the relevant CI subset)

**Files:** none (verification only).

**Interfaces:**
- Consumes: the full set of changes from Tasks 1-2.
- Produces: a PR-ready branch with the CI subset green.

- [ ] **Step 1: Build framework dist (so cross-package types resolve)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
Expected: all packages build; `hono-preact` consolidates. (Engine WARN on Node 24.10 is fine.)

- [ ] **Step 2: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format` and amend the relevant commit.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no `tsc --noEmit` errors across packages).

- [ ] **Step 4: Type tests (full suite)**

Run: `pnpm test:types`
Expected: PASS, including the new `define-channel.test-d.ts`.

- [ ] **Step 5: Unit tests with coverage (full suite)**

Run: `pnpm test:coverage`
Expected: PASS, including the new `interpolate-pattern.test.ts` and `define-channel.test.ts`, and the unchanged `build-path.test.ts`. No other suite regresses.

- [ ] **Step 6: Final status review**

Run: `git status` and `git log --oneline -4`
Expected: working tree clean; two feature/refactor commits plus the spec and plan commits on `worktree-first-class-realtime`. The PR is ready to open. (Per the PR workflow, run a deep PR review immediately after opening.)

---

## Self-Review

**Spec coverage (PR 1 row + substrate section + risk #1):**
- `defineChannel` typed descriptor with `/:param` grammar and reused `RouteParams` engine: Task 2.
- Branded `Topic<Payload>` carrying the payload type: Task 2 (`Topic`), proven in Task 2's type test.
- Factory-only, no global registry: Task 2 (no module augmentation introduced).
- Channel = address vocabulary; `key()` strict construction / string at the wire: Task 2 (returns a plain string under the brand, via the shared helper).
- DRY interpolation (no duplication of build-path's logic): Task 1 (shared helper + build-path refactor).
- Risk #1 (param engine delimiter-agnostic for `/:param`): proven by Task 2's `board`/`room`/`activity`/`ping` probes; if any fail, `RouteParams` is not reusable as-is and must be parameterized (would expand Task 2).
- Payload default `void` for signal channels: Task 2 (`<Payload = void>`), proven by the `ping` probe.
- Public export + docs: intentionally deferred to PR 2 (Global Constraints), not a gap.

**Placeholder scan:** none; every step has full code or an exact command + expected output.

**Type consistency:** `Channel<Name, Payload>`, `Topic<Payload>`, `KeyArgs<P>`, and `defineChannel`'s curried signature are used identically in the module (Task 2) and its type test; `interpolatePattern(pattern, values)` has the same signature where defined (Task 1) and consumed (Task 1 build-path, Task 2 define-channel); `key` is `(...args: KeyArgs<RouteParams<Name>>) => Topic<Payload>` in both the interface and the type test.
