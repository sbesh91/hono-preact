# Server error surfacing + dev diagnostics (issue #260, batch "server-diagnostics")

**For agentic workers:** Execute tasks in order (Task N+1 may assume Task N's commit exists on the branch). Work inside the worktree at `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/dx260-server-diagnostics` on branch `dx/260-server-diagnostics`. All paths below are repo-relative and resolve against that worktree root. Always use worktree-prefixed absolute paths when calling Read/Edit/Write. Run all commands from the worktree root. Commit per task; do NOT push and do NOT open a PR (the coordinator does that).

## Goal

Bring action, streaming, and bare-loader error surfacing to parity with the loader JSON path: mask internal detail in production, pass it through in dev, and add three dev-only console diagnostics, then make the docs and site demos reflect the new behavior.

## Architecture

All framework changes live in `packages/server/src`: `page-actions-handler.ts` gains a `dev` option (threaded from `create-server-entry.ts`) driving message passthrough plus two dev warnings; `sse.ts` gains a `dev` option on `SseResponseOptions` so the `event: error` frame masks in production; `loaders-handler.ts` gains an optional `findGuardedRoute` diagnostic matcher built by a new `makeGuardedRouteMatcher` helper in `route-server-modules.ts` (using the existing `findBestPattern` from `route-pattern.ts`). Docs updates land in `apps/site/src/pages/docs` and demo cleanups in `apps/site/src/pages/demo`.

## Tech Stack

TypeScript, Hono, Preact, vitest (root config: `vitest.config.ts`; server tests live in `packages/server/src/__tests__`, site tests under `apps/site/src/**/__tests__`), valibot (site demos only), pnpm monorepo.

## Global Constraints

- **No em-dashes** (`—`) in prose, code comments, commit messages, or docs text. Use commas, colons, parentheses, or two sentences.
- **No inline type casts** (`as X`). Reshape types instead. Acceptable only at untrusted-JSON / FormData / user-module-export boundaries, and in test fixtures where the surrounding file already uses `as never` for the same wiring (match the existing style exactly, do not add new cast styles).
- **TDD**: every behavior step writes the failing test first, runs it to observe the failure, implements minimally, re-runs to green, then commits.
- **Modularity over brevity**; match surrounding code style and comment density (these handler files are heavily commented; new code should explain WHY).
- **Conventional commits**, each ending with the exact trailer line:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **Exact masked strings** (verbatim, they are wire contract): JSON loader mask = `Loader failed`, JSON action mask = `Action failed`, SSE frame mask = `{"message":"Stream failed","name":"Error"}`.
- **Dev warning tests must filter `console.warn` calls by substring** (e.g. `.filter((call) => String(call[0]).includes('input schema'))`) rather than asserting total call counts, because multiple diagnostics can fire in one request once all tasks land.
- Test command from worktree root: `pnpm exec vitest run <path>`.
- The final task runs the framework build (`pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`) before `pnpm typecheck` and the site build, because `apps/site` and typecheck resolve framework types through `dist/`.
- Do not add a `.unchecked` action variant or any subtree binder API (`serverRoute` wildcard / `serverLayout`); both are explicitly deferred.

---

## Task 1: Actions: dev-mode error message passthrough + deny() hint

Actions currently mask every thrown non-outcome error as `Action failed` unconditionally (`packages/server/src/page-actions-handler.ts:325`), while loaders pass the message through in dev (`packages/server/src/loaders-handler.ts:304`). Add a `dev` option to `pageActionsHandler`, dev passthrough on all three action error surfaces (JSON envelope, fail-closed chain message, PE no-node text), and a dev-only console hint pointing at `deny(status, message)` when an action throws a plain error.

**Files**

- Modify: `packages/server/src/page-actions-handler.ts` (options interface ~line 34-106, destructure ~line 166-175, fail-closed branch ~line 249-255, catch else-branch ~line 323-326, PE no-node branch ~line 400-402, new module-scope helper near `EMPTY_PAGE_USE` ~line 108)
- Modify: `packages/server/src/create-server-entry.ts` (actions handler construction ~line 168-183: thread `dev`)
- Modify: `packages/server/src/loaders-handler.ts` (stale comment ~line 270-274 only)
- Test: `packages/server/src/__tests__/page-actions-handler.test.ts`
- Test: `packages/server/src/__tests__/create-server-entry.test.ts`

**Interfaces**

Consumes: existing `PageActionsHandlerOptions`, `ActionResolution` (from `@hono-preact/iso/internal`; its `'error'` variant carries `message: string`).
Produces:
- `PageActionsHandlerOptions.dev?: boolean` (default `false`).
- Module-scope `function warnPlainErrorThrown(module: string, action: string, err: unknown): void` in `page-actions-handler.ts` (not exported).
- `createServerEntry` passes its existing `dev` flag into `pageActionsHandler`.

Steps:

- [ ] **Step 1: Write the failing tests.** In `packages/server/src/__tests__/page-actions-handler.test.ts`, first extend the `buildHandler` helper (defined ~line 36-77) with a third parameter so tests can pass handler options. Replace its signature line and the `pageActionsHandler({...})` call:

  ```ts
  function buildHandler(
    actions: Record<
      string,
      | ((ctx: unknown, payload: unknown) => Promise<unknown>)
      | {
          fn: (ctx: unknown, payload: unknown) => Promise<unknown>;
          input?: import('@standard-schema/spec').StandardSchemaV1;
          use?: ReadonlyArray<unknown>;
          routeId?: string;
        }
    >,
    pageUse?: { byPattern?: PageUseResolver },
    extra?: {
      dev?: boolean;
      onError?: (
        err: unknown,
        ctx: { module: string; action: string; routeId?: string }
      ) => void;
    }
  ) {
  ```

  and change the return to spread `extra` last:

  ```ts
    return pageActionsHandler({
      resolverByPath,
      // No page-level middleware in the default fixture. Bare actions get no page
      // tier at all; the byPattern branch tests below inject a resolver to observe
      // the route-bound path.
      resolvePageUseByPattern: pageUse?.byPattern ?? (async () => []),
      renderPage: renderPage as never,
      resolvePageNode: () => h('div', null),
      appConfig: { use: [] },
      ...extra,
    });
  ```

  Then append a new describe block at the end of the top-level `describe('pageActionsHandler', ...)` (after the coercion test ~line 529, still inside the describe closing brace):

  ```ts
  describe('error masking and the dev deny() hint', () => {
    const postSubmit = (handler: ReturnType<typeof pageActionsHandler>) =>
      new Hono().post('*', handler).request('/foo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          module: 'pages/test.server',
          action: 'submit',
          payload: { x: 1 },
        }),
      });

    it('masks a thrown non-outcome error as Action failed by default (production)', async () => {
      const handler = buildHandler({
        submit: async () => {
          throw new Error('DB error: connection refused at 10.0.0.5');
        },
      });
      const res = await postSubmit(handler);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ __outcome: 'error', message: 'Action failed' });
    });

    it('passes the thrown error message through when dev: true', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler(
          {
            submit: async () => {
              throw new Error('DB error: hostname leaked');
            },
          },
          undefined,
          { dev: true }
        );
        const res = await postSubmit(handler);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body).toEqual({
          __outcome: 'error',
          message: 'DB error: hostname leaked',
        });
      } finally {
        warn.mockRestore();
      }
    });

    it('hints at deny(status, message) on the console when dev: true', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler(
          {
            submit: async () => {
              throw new Error('email is required');
            },
          },
          undefined,
          { dev: true }
        );
        await postSubmit(handler);
        const hints = warn.mock.calls.filter((call) =>
          String(call[0]).includes('deny(status, message)')
        );
        expect(hints).toHaveLength(1);
        expect(String(hints[0]![0])).toContain('pages/test.server::submit');
        expect(String(hints[0]![0])).toContain('email is required');
      } finally {
        warn.mockRestore();
      }
    });

    it('does not hint on the console in production (dev omitted)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler({
          submit: async () => {
            throw new Error('boom');
          },
        });
        await postSubmit(handler);
        const hints = warn.mock.calls.filter((call) =>
          String(call[0]).includes('deny(status, message)')
        );
        expect(hints).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });

    it('includes the resolver error detail in the fail-closed message only when dev: true', async () => {
      const byPattern = async () => {
        throw new Error('resolver boom: internal path /srv/gates.ts');
      };
      const routeBound = {
        submit: {
          fn: async () => ({ ok: true }),
          routeId: '/foo/:id',
        },
      };
      const prodRes = await postSubmit(buildHandler(routeBound, { byPattern }));
      expect(prodRes.status).toBe(500);
      const prodBody = await prodRes.json();
      expect(prodBody.message).toBe(
        "Route-bound action '/foo/:id' could not resolve its page-use chain"
      );
      const devRes = await postSubmit(
        buildHandler(routeBound, { byPattern }, { dev: true })
      );
      const devBody = await devRes.json();
      expect(devBody.message).toContain(
        'resolver boom: internal path /srv/gates.ts'
      );
    });
  });
  ```

- [ ] **Step 2: Run the new tests and observe the failures.** Run:
  `pnpm exec vitest run packages/server/src/__tests__/page-actions-handler.test.ts`
  Expected: the production-mask test passes (current behavior already masks); the `dev: true` passthrough test fails with received message `'Action failed'`; the hint test fails with 0 warn calls; the fail-closed dev test fails because the dev body message lacks the detail.

- [ ] **Step 3: Implement in `page-actions-handler.ts`.** Four edits plus one new helper.

  (a) Add the `dev` option to `PageActionsHandlerOptions`, immediately after the `defaultTimeoutMs` member (~line 96):

  ```ts
    /**
     * When true, error responses pass the thrown error's message through to
     * the client and the handler emits console diagnostics (e.g. the deny()
     * hint when an action throws a plain Error). When false (default), a
     * thrown non-outcome error is masked as 'Action failed'; the raw error
     * still reaches `onError`. The framework's generated server entry threads
     * its own dev flag here, matching loadersHandler.
     */
    dev?: boolean;
  ```

  (b) Destructure it (~line 166-175): add `dev = false,` after `defaultTimeoutMs = 30_000,`.

  (c) Add the module-scope helper directly after the `EMPTY_PAGE_USE` constant (~line 111):

  ```ts
  // Dev-only console hint for an action that threw a plain (non-outcome)
  // error. The JSON envelope masks such errors as 'Action failed' in
  // production, so an intentional denial thrown as `new Error(...)` silently
  // loses its message; point at deny(status, message), which reaches the
  // client with its status and message in every mode.
  function warnPlainErrorThrown(
    module: string,
    action: string,
    err: unknown
  ): void {
    const detail =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(
      `hono-preact: action '${module}::${action}' threw (${detail}). ` +
        `Production responses mask this as 'Action failed'. If this is an ` +
        `intentional denial, throw deny(status, message) instead so the ` +
        `client receives the status and message in every mode.`
    );
  }
  ```

  (d) Replace the fail-closed branch (~line 249-255). Current code:

  ```ts
      if (!composed.ok) {
        onError?.(composed.error, { module, action, routeId });
        const message = `Route-bound action '${routeId}' could not resolve its page-use chain`;
  ```

  New code:

  ```ts
      if (!composed.ok) {
        onError?.(composed.error, { module, action, routeId });
        // The raw resolver message may carry internal detail; surface it only
        // in dev, matching the loaders-handler twin. Both mask in production.
        const detail = dev
          ? `: ${composed.error instanceof Error ? composed.error.message : String(composed.error)}`
          : '';
        const message = `Route-bound action '${routeId}' could not resolve its page-use chain${detail}`;
  ```

  (e) Replace the catch else-branch (~line 323-326). Current code:

  ```ts
        } else {
          onError?.(err, { module, action, routeId });
          resolution = { kind: 'error', message: 'Action failed' };
        }
  ```

  New code:

  ```ts
        } else {
          onError?.(err, { module, action, routeId });
          // In production the client never sees the raw error text (it may
          // carry PII or internal detail); denials users want to surface
          // should be thrown as deny(status, message), not plain errors.
          if (dev) warnPlainErrorThrown(module, action, err);
          resolution = {
            kind: 'error',
            message:
              dev && err instanceof Error ? err.message : 'Action failed',
          };
        }
  ```

  (f) In the PE no-node branch (~line 400-402), replace:

  ```ts
          return c.text('Action failed', 500);
  ```

  with:

  ```ts
          return c.text(
            resolution.kind === 'error' ? resolution.message : 'Action failed',
            500
          );
  ```

- [ ] **Step 4: Thread `dev` from `create-server-entry.ts`.** In the `pageActionsHandler({...})` construction (~line 168), add `dev,` as the first property:

  ```ts
    const actions = pageActionsHandler({
      dev,
      resolverByPath: pageActionResolvers.byPath,
  ```

  Then update the now-stale comment in `packages/server/src/loaders-handler.ts` (~line 270-275). Replace the final parenthetical sentence:

  ```ts
      // the observability side channel. (The page-actions-handler twin masks
      // unconditionally because it has no dev option; both mask in production.)
  ```

  with:

  ```ts
      // the observability side channel. (The page-actions-handler twin applies
      // the same dev gate; both mask in production.)
  ```

- [ ] **Step 5: Re-run and commit.** Run:
  `pnpm exec vitest run packages/server/src/__tests__/page-actions-handler.test.ts packages/server/src/__tests__/create-server-entry.test.ts packages/server/src/__tests__/loaders-handler.test.ts`
  Expected: all pass. Then:

  ```
  git add packages/server/src/page-actions-handler.ts packages/server/src/create-server-entry.ts packages/server/src/loaders-handler.ts packages/server/src/__tests__/page-actions-handler.test.ts
  git commit -m "fix(server): pass action error messages through in dev and hint at deny()

  Actions masked every thrown non-outcome error as 'Action failed'
  unconditionally while loaders already passed the message through in
  dev. pageActionsHandler now takes dev (threaded from the generated
  server entry), applies the same dev-gated passthrough on the JSON
  envelope, the fail-closed chain message, and the PE no-node text, and
  prints a dev hint pointing at deny(status, message) when an action
  throws a plain Error (issue #260, finding 3).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 2: SSE: mask `event: error` frames in production, pass through in dev

`encodeErrorPayload` (`packages/server/src/sse.ts:74-78`) puts raw `err.message`/`err.name` on the `event: error` frame with no dev gate: the inverse bug of the JSON path. Mask in production, pass through in dev, and thread `dev` from both handlers into the SSE responders.

**Files**

- Modify: `packages/server/src/sse.ts` (`SseResponseOptions` ~line 23-46, `encodeErrorPayload` ~line 74-78, `buildSseResponse` destructure ~line 114-120 and catch ~line 158)
- Modify: `packages/server/src/loaders-handler.ts` (both SSE call sites, ~line 379-386 and ~line 389-395)
- Modify: `packages/server/src/page-actions-handler.ts` (`sseOpts` object ~line 331-337)
- Test: `packages/server/src/__tests__/sse.test.ts` (update the error-frame test, add a mask test)
- Test: `packages/server/src/__tests__/sse-wire-snapshot.test.ts` (update the error snapshot, add a dev snapshot)
- Test: `packages/server/src/__tests__/loaders-handler.test.ts` (threading tests)
- Test: `packages/server/src/__tests__/page-actions-handler.test.ts` (threading test)

**Interfaces**

Consumes: `SseResponseOptions`, the `dev` locals already destructured in both handlers (loaders: existing; actions: added in Task 1).
Produces:
- `SseResponseOptions.dev?: boolean` (default `false`).
- `encodeErrorPayload(err: unknown, dev: boolean): string` (module-private; masked value is exactly `{"message":"Stream failed","name":"Error"}`).
- Timeout frames (`event: timeout`) are unchanged; they carry only `timeoutMs`.

Steps:

- [ ] **Step 1: Write the failing SSE unit tests.** In `packages/server/src/__tests__/sse.test.ts`, replace the existing test `'frames thrown errors as event: error JSON'` (~line 65-78) with a dev-gated pair:

  ```ts
    it('frames thrown errors as event: error JSON with the real message when dev: true', async () => {
      async function* gen(): AsyncGenerator<unknown, unknown, unknown> {
        yield { a: 1 };
        throw new Error('bad');
      }
      const res = await makeApp((c) =>
        sseGeneratorResponse(c, gen(), { dev: true })
      ).request('/x');
      const body = await res.text();
      expect(body).toContain('data: {"a":1}');
      expect(body).toContain('event: error');
      expect(body).toContain('"message":"bad"');
      expect(body).toContain('"name":"Error"');
    });

    it('masks the error frame message by default (production)', async () => {
      async function* gen(): AsyncGenerator<unknown, unknown, unknown> {
        yield { a: 1 };
        throw new Error('DB error: connection refused at 10.0.0.5');
      }
      const res = await makeApp((c) => sseGeneratorResponse(c, gen())).request(
        '/x'
      );
      const body = await res.text();
      expect(body).toContain('event: error');
      expect(body).toContain('"message":"Stream failed"');
      expect(body).toContain('"name":"Error"');
      expect(body).not.toContain('10.0.0.5');
    });
  ```

  In `packages/server/src/__tests__/sse-wire-snapshot.test.ts`, replace the body assertion of `'generator error path: emits event: error frame'` (~line 68-71) with the masked wire contract:

  ```ts
      expect(body).toBe(
        'data: "before"\n\n' +
          'event: error\ndata: {"message":"Stream failed","name":"Error"}\n\n'
      );
  ```

  and add a sibling test after it (inside the same describe):

  ```ts
    it('generator error path (dev): emits the raw message on the error frame', async () => {
      const app = new Hono();
      app.get('/', (c) =>
        sseGeneratorResponse(
          c,
          (async function* () {
            yield 'before';
            throw new Error('boom');
          })(),
          { dev: true }
        )
      );

      const res = await app.request('http://localhost/');
      const body = await bodyToString(res);
      expect(body).toBe(
        'data: "before"\n\n' +
          'event: error\ndata: {"message":"boom","name":"Error"}\n\n'
      );
    });
  ```

- [ ] **Step 2: Write the failing handler-threading tests.** Append to `packages/server/src/__tests__/loaders-handler.test.ts` (top level, after the existing `describe('loadersHandler dev / caching', ...)` block):

  ```ts
  describe('loadersHandler streaming error frames', () => {
    const streamGlob = {
      './pages/live.server.ts': {
        __moduleKey: 'pages/live',
        serverLoaders: {
          feed: async function* () {
            yield { tick: 1 };
            throw new Error('DB error: connection refused at 10.0.0.5');
          },
        },
      },
    };
    const postFeed = (app: Hono) =>
      app.request('http://localhost/__loaders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'pages/live',
          loader: 'feed',
          location: loc,
        }),
      });

    it('masks the mid-stream error frame by default (production)', async () => {
      const res = await postFeed(makeApp(streamGlob));
      const body = await res.text();
      expect(body).toContain('data: {"tick":1}');
      expect(body).toContain('"message":"Stream failed"');
      expect(body).not.toContain('10.0.0.5');
    });

    it('passes the mid-stream error message through when dev: true', async () => {
      const app = new Hono();
      app.post(
        '/__loaders',
        loadersHandler(streamGlob, {
          dev: true,
          resolvePageUse: async () => [],
        })
      );
      const res = await postFeed(app);
      const body = await res.text();
      expect(body).toContain(
        '"message":"DB error: connection refused at 10.0.0.5"'
      );
    });
  });
  ```

  Append to `packages/server/src/__tests__/page-actions-handler.test.ts` (inside the `describe('pageActionsHandler', ...)` block, after the coercion test):

  ```ts
    it('gates the streaming action error frame on dev', async () => {
      const make = (dev: boolean) =>
        pageActionsHandler({
          resolverByPath: async () =>
            new Map([
              [
                'stream',
                {
                  fn: async () =>
                    (async function* () {
                      yield { tick: 1 };
                      throw new Error('secret detail');
                    })(),
                  use: [],
                  moduleKey: 'pages/test.server',
                },
              ],
            ]) as never,
          resolvePageUseByPattern: async () => [],
          renderPage: (async () => new Response('x')) as never,
          resolvePageNode: () => h('div', null),
          appConfig: { use: [] },
          dev,
        });
      const post = (handler: ReturnType<typeof pageActionsHandler>) =>
        new Hono().post('*', handler).request('/foo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            module: 'pages/test.server',
            action: 'stream',
            payload: {},
          }),
        });
      const prodBody = await (await post(make(false))).text();
      expect(prodBody).toContain('"message":"Stream failed"');
      expect(prodBody).not.toContain('secret detail');
      const devBody = await (await post(make(true))).text();
      expect(devBody).toContain('"message":"secret detail"');
    });
  ```

- [ ] **Step 3: Run and observe failures.** Run:
  `pnpm exec vitest run packages/server/src/__tests__/sse.test.ts packages/server/src/__tests__/sse-wire-snapshot.test.ts packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/__tests__/page-actions-handler.test.ts`
  Expected: the mask tests fail (raw messages still appear, e.g. body contains `10.0.0.5` / `boom` where masks are expected); the dev-flagged tests pass or fail benignly (extra unknown option is ignored at runtime, so dev tests currently pass because raw is the default). The failing ones are the production-mask assertions.

- [ ] **Step 4: Implement in `sse.ts`.**

  (a) Add to `SseResponseOptions`, after the `timeoutMs` member (~line 45):

  ```ts
    /**
     * When true, a thrown stream error's real `message` and `name` ride the
     * `event: error` frame. When false (default), the frame is masked as
     * `{ message: 'Stream failed', name: 'Error' }`: mid-stream errors reach
     * the client verbatim on the wire, so production must not leak internal
     * detail (mirroring the JSON paths' 'Loader failed' / 'Action failed'
     * masking). Timeout frames are unaffected; they carry only `timeoutMs`.
     */
    dev?: boolean;
  ```

  (b) Replace `encodeErrorPayload` (~line 74-78):

  ```ts
  function encodeErrorPayload(err: unknown, dev: boolean): string {
    if (!dev) {
      // Production: the frame reaches the client verbatim, so mask like the
      // JSON error paths do. Stream observers (fanError) already received the
      // real error for the observability side channel.
      return JSON.stringify({ message: 'Stream failed', name: 'Error' });
    }
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : 'Error';
    return JSON.stringify({ message, name });
  }
  ```

  (c) In `buildSseResponse`, destructure the flag (~line 114-120): add `dev = false,` after `timeoutMs,`. In the catch path (~line 158), change:

  ```ts
          yield { event: 'error', data: encodeErrorPayload(err) };
  ```

  to:

  ```ts
          yield { event: 'error', data: encodeErrorPayload(err, dev) };
  ```

- [ ] **Step 5: Thread `dev` from both handlers.** In `packages/server/src/loaders-handler.ts`, add `dev,` to both SSE option objects. Generator call site (~line 379):

  ```ts
        return sseGeneratorResponse(c, result, {
          emitResult: false,
          dev,
          observers,
  ```

  ReadableStream call site (~line 389):

  ```ts
        return sseReadableStreamResponse(c, result, {
          dev,
          observers,
  ```

  In `packages/server/src/page-actions-handler.ts`, add `dev,` to the shared `sseOpts` object (~line 331):

  ```ts
        const sseOpts = {
          dev,
          observers,
  ```

- [ ] **Step 6: Re-run and commit.** Run the same vitest command as Step 3. Expected: all pass. Then:

  ```
  git add packages/server/src/sse.ts packages/server/src/loaders-handler.ts packages/server/src/page-actions-handler.ts packages/server/src/__tests__/sse.test.ts packages/server/src/__tests__/sse-wire-snapshot.test.ts packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/__tests__/page-actions-handler.test.ts
  git commit -m "fix(server): mask SSE error frames in production

  encodeErrorPayload put raw err.message/err.name on the event: error
  frame unconditionally, leaking internal detail in production while the
  JSON paths mask it. SseResponseOptions gains dev (threaded from both
  the loaders and actions handlers); production frames now carry
  {\"message\":\"Stream failed\",\"name\":\"Error\"} and dev keeps the
  raw passthrough (issue #260, finding 4).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 3: Dev warning: action with an object payload but no input schema

`defineAction<Payload, Result>(fn)` with explicit generics reads as safe but validates nothing at runtime. Warn once per action (per handler instance), dev only, when a dispatched action has no `input` schema and its payload is a non-null object with at least one own key. No API changes; no `.unchecked` variant.

**Files**

- Modify: `packages/server/src/page-actions-handler.ts` (new module-scope helper after `warnPlainErrorThrown`; a `Set` in the `pageActionsHandler` closure; one call in the request path after the entry lookup ~line 203-208)
- Test: `packages/server/src/__tests__/page-actions-handler.test.ts`

**Interfaces**

Consumes: `entry.input` (`StandardSchemaV1 | undefined` on `ActionEntry`), the `dev` local from Task 1, the parsed `payload` (unknown).
Produces: module-scope `function warnMissingInputSchema(warned: Set<string>, module: string, action: string, payload: unknown): void` (not exported). Dedup key: `` `${module}::${action}` ``.

Steps:

- [ ] **Step 1: Write the failing tests.** Append to `packages/server/src/__tests__/page-actions-handler.test.ts` (top level, after the `describe('pageActionsHandler timeouts', ...)` block). Note the helper filters warn calls by the substring `input schema` so other diagnostics never interfere:

  ```ts
  describe('pageActionsHandler missing-input-schema dev warning', () => {
    const schemaWarnings = (calls: ReadonlyArray<ReadonlyArray<unknown>>) =>
      calls.filter((call) => String(call[0]).includes('input schema'));

    const postSubmit = (
      handler: ReturnType<typeof pageActionsHandler>,
      payload: unknown
    ) =>
      new Hono().post('*', handler).request('/foo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          module: 'pages/test.server',
          action: 'submit',
          payload,
        }),
      });

    it('warns once per action when an object payload arrives with no input schema (dev)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler(
          { submit: async () => ({ ok: true }) },
          undefined,
          { dev: true }
        );
        await postSubmit(handler, { title: 'a' });
        await postSubmit(handler, { title: 'b' });
        const warnings = schemaWarnings(warn.mock.calls);
        expect(warnings).toHaveLength(1);
        expect(String(warnings[0]![0])).toContain('pages/test.server::submit');
        expect(String(warnings[0]![0])).toContain('{ input: schema }');
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn when the action declares an input schema', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler(
          { submit: { fn: async () => 'ok', input: coercing } },
          undefined,
          { dev: true }
        );
        await postSubmit(handler, { count: '3' });
        expect(schemaWarnings(warn.mock.calls)).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn for an empty object payload', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler(
          { submit: async () => ({ ok: true }) },
          undefined,
          { dev: true }
        );
        await postSubmit(handler, {});
        expect(schemaWarnings(warn.mock.calls)).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn in production (dev omitted)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const handler = buildHandler({ submit: async () => ({ ok: true }) });
        await postSubmit(handler, { title: 'a' });
        expect(schemaWarnings(warn.mock.calls)).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });
  });
  ```

- [ ] **Step 2: Run and observe failures.** Run:
  `pnpm exec vitest run packages/server/src/__tests__/page-actions-handler.test.ts -t 'missing-input-schema'`
  Expected: the first test fails with 0 warnings found; the three negative tests pass.

- [ ] **Step 3: Implement.** In `packages/server/src/page-actions-handler.ts`:

  (a) Add the module-scope helper directly after `warnPlainErrorThrown` (added in Task 1; if it is absent, place this after the `EMPTY_PAGE_USE` constant):

  ```ts
  // Dev-only warning for an action invoked with a real object payload but no
  // input schema. Explicit payload generics read as safe yet validate nothing
  // at runtime; the raw client payload reaches the handler as-is. Fires once
  // per action key (not per request) via the handler-instance Set the caller
  // owns. An empty object carries no client data to validate, so it is exempt
  // (payload-less invocations and empty form posts serialize to {}).
  function warnMissingInputSchema(
    warned: Set<string>,
    module: string,
    action: string,
    payload: unknown
  ): void {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Object.keys(payload).length === 0
    ) {
      return;
    }
    const key = `${module}::${action}`;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(
      `hono-preact: action '${key}' received an object payload but declares ` +
        `no input schema, so the payload reaches the handler unvalidated ` +
        `(payload type generics are compile-time only). Pass a Standard ` +
        `Schema via defineAction(fn, { input: schema }) to validate and type ` +
        `it at runtime.`
    );
  }
  ```

  (b) In `pageActionsHandler`, after the `assertPageUseResolver(...)` call and before `return async (c) => {`, add:

  ```ts
    // Dedup store for warnMissingInputSchema: one warning per action key for
    // the life of this handler instance (per process in prod, per module-map
    // rebuild boundary in dev, which is close enough for a console hint).
    const warnedMissingSchema = new Set<string>();
  ```

  (c) In the request path, after the entry-miss 404 branch (the `if (!entry || entry.moduleKey !== module) { ... }` block ending ~line 208) and before `const { fn, use: actionUse, timeoutMs, routeId } = entry;`, add:

  ```ts
      if (dev && entry.input === undefined) {
        warnMissingInputSchema(warnedMissingSchema, module, action, payload);
      }
  ```

- [ ] **Step 4: Re-run and commit.** Run:
  `pnpm exec vitest run packages/server/src/__tests__/page-actions-handler.test.ts`
  Expected: all pass (including Task 1 and Task 2 tests in the same file). Then:

  ```
  git add packages/server/src/page-actions-handler.ts packages/server/src/__tests__/page-actions-handler.test.ts
  git commit -m "feat(server): dev-warn actions that take object payloads without an input schema

  Explicit defineAction generics read as safe but validate nothing at
  runtime. In dev, the actions handler now warns once per action when a
  dispatched action has no input schema and its payload is a non-empty
  object, pointing at defineAction(fn, { input: schema }) (issue #260,
  finding 3; the .unchecked variant design stays deferred).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 4: Dev warning: bare loader serving a request on a guarded route

A bare `defineLoader` gets `EMPTY_PAGE_USE` (`packages/server/src/loaders-handler.ts:173`, used at :262), so under a gated subtree its RPC serves with no page tier and no signal. Add a dev-only warning when a bare loader serves a request whose matched route pattern carries `use`. The subtree binder API is deferred; the warning points at the existing `serverRoute(pattern).loader` and unit-level `use` escape hatches.

**Files**

- Modify: `packages/server/src/route-server-modules.ts` (new exported `makeGuardedRouteMatcher`)
- Modify: `packages/server/src/loaders-handler.ts` (new option `findGuardedRoute`, closure `Set`, warn call after `routeBound` is computed ~line 255, module-scope helper)
- Modify: `packages/server/src/create-server-entry.ts` (build the matcher, pass it to `loadersHandler` ~line 160-167)
- Test: `packages/server/src/__tests__/route-server-modules.test.ts`
- Test: `packages/server/src/__tests__/loaders-handler.test.ts`
- Test: `packages/server/src/__tests__/create-server-entry.test.ts`

**Interfaces**

- `makeGuardedRouteMatcher(routeUse: ReadonlyArray<{ path: string; use: ReadonlyArray<unknown> }>): (urlPath: string) => string | null` exported from `route-server-modules.ts`. Returns the best-matching pattern (via the existing `findBestPattern` in `route-pattern.ts`) when that pattern's folded `use` is non-empty, else `null`. `RoutesManifest.routeUse` already satisfies the parameter structurally (its entries fold ancestor `use`).
- `LoadersHandlerOptions.findGuardedRoute?: (urlPath: string) => string | null` (optional; absent skips the diagnostic).
- Module-scope `function warnBareLoaderOnGuardedRoute(warned: Set<string>, info: { module: string; loader: string; path: string; pattern: string }): void` in `loaders-handler.ts` (not exported). Dedup key: `` `${module}::${loader}` ``.

Steps:

- [ ] **Step 1: Write the failing matcher tests.** Append to `packages/server/src/__tests__/route-server-modules.test.ts` (add `makeGuardedRouteMatcher` to the existing import from `'../route-server-modules.js'`):

  ```ts
  describe('makeGuardedRouteMatcher', () => {
    const guard = { marker: 'guard' };

    it('returns the matched pattern when the best match carries use', () => {
      const match = makeGuardedRouteMatcher([
        { path: '/admin/:section', use: [guard] },
        { path: '/public', use: [] },
      ]);
      expect(match('/admin/settings')).toBe('/admin/:section');
    });

    it('returns null when the best match carries no use', () => {
      // '/admin/health' (all literal segments) outranks '/admin/:rest*'. Its
      // folded use is empty, so the URL is not considered guarded even though
      // a broader guarded pattern also matches. routeUse entries already fold
      // ancestor use, so a genuinely gated child never has an empty entry.
      const match = makeGuardedRouteMatcher([
        { path: '/admin/:rest*', use: [guard] },
        { path: '/admin/health', use: [] },
      ]);
      expect(match('/admin/health')).toBeNull();
    });

    it('returns null when nothing matches', () => {
      const match = makeGuardedRouteMatcher([{ path: '/a', use: [guard] }]);
      expect(match('/b/c')).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run and observe the failure.** Run:
  `pnpm exec vitest run packages/server/src/__tests__/route-server-modules.test.ts`
  Expected: fails to import (`makeGuardedRouteMatcher` is not exported).

- [ ] **Step 3: Implement the matcher.** In `packages/server/src/route-server-modules.ts`, add at the top:

  ```ts
  import { findBestPattern } from './route-pattern.js';
  ```

  and append after `makePageUseResolver`:

  ```ts
  /**
   * Build a dev-diagnostic matcher over the manifest's `routeUse`: given a
   * concrete URL path, return the best-matching route pattern when that
   * pattern's folded `use` chain is non-empty, else null. loadersHandler uses
   * it to warn (dev only) when a bare (route-independent) loader serves a
   * request under a guarded route, since the bare loader's RPC runs none of
   * that route's guards.
   *
   * Purely observational: the result never feeds guard resolution, so the URL
   * fuzzy-match that is forbidden for `makePageUseResolver` (see its note on
   * the byPath footgun) is safe here. A wrong best-match costs at most a
   * console hint.
   *
   * NOTE: framework-private. The only intended consumer is the generated
   * server entry.
   */
  export function makeGuardedRouteMatcher(
    routeUse: ReadonlyArray<{ path: string; use: ReadonlyArray<unknown> }>
  ): (urlPath: string) => string | null {
    const useByPattern = new Map(routeUse.map((r) => [r.path, r.use]));
    return (urlPath) => {
      const best = findBestPattern(useByPattern.keys(), urlPath);
      if (best === null) return null;
      const use = useByPattern.get(best);
      return use !== undefined && use.length > 0 ? best : null;
    };
  }
  ```

  Re-run the Step 2 command. Expected: pass.

- [ ] **Step 4: Write the failing handler tests.** Append to `packages/server/src/__tests__/loaders-handler.test.ts` (top level):

  ```ts
  describe('loadersHandler bare-loader guarded-route dev warning', () => {
    const bareGlob = {
      './pages/board.server.ts': {
        __moduleKey: 'pages/board',
        serverLoaders: { default: async () => ({ ok: true }) },
      },
    };
    const gatedLoc = { path: '/admin/board', pathParams: {}, searchParams: {} };
    const findGuardedRoute = (urlPath: string) =>
      urlPath.startsWith('/admin') ? '/admin/:section' : null;

    const bareWarnings = (calls: ReadonlyArray<ReadonlyArray<unknown>>) =>
      calls.filter((call) => String(call[0]).includes('bare loader'));

    const makeWarnApp = (
      opts: Partial<Parameters<typeof loadersHandler>[1]>
    ) => {
      const app = new Hono();
      app.post(
        '/__loaders',
        loadersHandler(bareGlob, { resolvePageUse: async () => [], ...opts })
      );
      return app;
    };
    const postBoard = (app: Hono, path: string) =>
      app.request('http://localhost/__loaders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'pages/board',
          loader: 'default',
          location: { ...gatedLoc, path },
        }),
      });

    it('warns once per bare loader when the request path matches a guarded route (dev)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const app = makeWarnApp({ dev: true, findGuardedRoute });
        await postBoard(app, '/admin/board');
        await postBoard(app, '/admin/board');
        const warnings = bareWarnings(warn.mock.calls);
        expect(warnings).toHaveLength(1);
        expect(String(warnings[0]![0])).toContain('pages/board::default');
        expect(String(warnings[0]![0])).toContain('/admin/:section');
        expect(String(warnings[0]![0])).toContain(
          "serverRoute('/admin/:section')"
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn when the matched route carries no use', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const app = makeWarnApp({ dev: true, findGuardedRoute });
        await postBoard(app, '/public/board');
        expect(bareWarnings(warn.mock.calls)).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn in production (dev omitted)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const app = makeWarnApp({ findGuardedRoute });
        await postBoard(app, '/admin/board');
        expect(bareWarnings(warn.mock.calls)).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });

    it('does not warn for a route-bound loader', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const boundGlob = {
          './pages/board.server.ts': {
            __moduleKey: 'pages/board',
            serverLoaders: {
              default: {
                fn: async () => ({ ok: true }),
                use: [],
                __routeId: '/admin/:section',
              },
            },
          },
        };
        const app = new Hono();
        app.post(
          '/__loaders',
          loadersHandler(boundGlob, {
            dev: true,
            findGuardedRoute,
            resolvePageUse: async () => [],
          })
        );
        const res = await postBoard(app, '/admin/board');
        expect(res.status).toBe(200);
        expect(bareWarnings(warn.mock.calls)).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });
  });
  ```

  Then append a wiring test to `packages/server/src/__tests__/create-server-entry.test.ts` (inside the `describe('createServerEntry', ...)` block; also add `vi` to the vitest import at line 1: `import { describe, it, expect, vi } from 'vitest';`):

  ```ts
    it('wires the bare-loader guarded-route dev warning (dev: true)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const pageGuard = defineServerMiddleware<'loader'>(
          async (_c, next) => {
            await next();
          }
        );
        const app = createServerEntry({
          routes: manifest({
            serverImports: [
              async () => ({
                __moduleKey: 'test/bare',
                serverLoaders: { l: async () => 'ok' },
              }),
            ],
            routeUse: [{ path: '/x', use: [pageGuard] }],
          }),
          layout: Layout,
          dev: true,
        });
        const res = await app.request('/__loaders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            module: 'test/bare',
            loader: 'l',
            location: { path: '/x', pathParams: {}, searchParams: {} },
          }),
        });
        expect(res.status).toBe(200);
        const warnings = warn.mock.calls.filter((call) =>
          String(call[0]).includes('bare loader')
        );
        expect(warnings).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });
  ```

- [ ] **Step 5: Run and observe failures.** Run:
  `pnpm exec vitest run packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/__tests__/create-server-entry.test.ts`
  Expected: the positive warning tests fail with 0 warnings; the negative tests pass.

- [ ] **Step 6: Implement in `loaders-handler.ts` and `create-server-entry.ts`.**

  (a) `loaders-handler.ts`: add the option to `LoadersHandlerOptions` after `defaultTimeoutMs` (~line 167):

  ```ts
    /**
     * Dev-only diagnostic matcher: given a concrete request URL path, return
     * the best-matching route pattern when that route carries page-level
     * `use`, else null. Used to warn when a bare (route-independent) loader
     * serves a request under a guarded route, since the bare loader RPC runs
     * none of that route's guards. Never used for guard resolution (the URL
     * is client-sent). Optional: absent skips the warning. The generated
     * server entry passes makeGuardedRouteMatcher(routes.routeUse).
     */
    findGuardedRoute?: (urlPath: string) => string | null;
  ```

  (b) Destructure it (~line 184-190): add `findGuardedRoute,` after `defaultTimeoutMs = 30_000,`.

  (c) Add the module-scope helper directly after the `EMPTY_PAGE_USE` constant (~line 173):

  ```ts
  // Dev-only warning for a bare (route-independent) loader serving a request
  // whose matched route carries page-level `use`. The bare loader's RPC
  // composes no page tier, so those guards never ran; that is by design (see
  // EMPTY_PAGE_USE) but easy to miss when the loader module is colocated
  // under a gated subtree. Fires once per loader key via the handler-instance
  // Set the caller owns. The matched pattern derives from the client-sent
  // location path, which is fine for a console hint but must never feed guard
  // resolution.
  function warnBareLoaderOnGuardedRoute(
    warned: Set<string>,
    info: { module: string; loader: string; path: string; pattern: string }
  ): void {
    const key = `${info.module}::${info.loader}`;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(
      `hono-preact: bare loader '${key}' served a request for '${info.path}', ` +
        `and that path's matched route '${info.pattern}' declares page-level ` +
        `'use'. A bare defineLoader is route-independent, so those guards did ` +
        `NOT run on this RPC. If the loader should be gated, bind it with ` +
        `serverRoute('${info.pattern}').loader(fn) or give it a unit-level ` +
        `use: defineLoader(fn, { use: [...] }).`
    );
  }
  ```

  (d) In `loadersHandler`, after the `assertPageUseResolver(...)` call and before `return async (c) => {`, add:

  ```ts
    // Dedup store for warnBareLoaderOnGuardedRoute: one warning per bare
    // loader key for the life of this handler instance.
    const warnedBareGuarded = new Set<string>();
  ```

  (e) In the request path, directly after `const routeBound = typeof entry.routeId === 'string';` (~line 255), add:

  ```ts
      if (dev && !routeBound && findGuardedRoute) {
        const guarded = findGuardedRoute(validatedLocation.path);
        if (guarded !== null) {
          warnBareLoaderOnGuardedRoute(warnedBareGuarded, {
            module,
            loader: loaderName,
            path: validatedLocation.path,
            pattern: guarded,
          });
        }
      }
  ```

  (f) `create-server-entry.ts`: extend the import from `./route-server-modules.js` (~line 13-17) with `makeGuardedRouteMatcher`, and add the option to the `loadersHandler` construction (~line 160-167):

  ```ts
    const loaders = loadersHandler(serverModules, {
      dev,
      appConfig,
      // The loaders RPC resolves page-use from the loader's OWN declared route
      // pattern (`ref.__routeId`), so it needs the exact pattern lookup, not the
      // URL fuzzy-matcher: `byPath` could collide `/a/:x` with `/a/:y`.
      resolvePageUse: pageUseResolver.byPattern,
      // Dev diagnostic only: warns when a bare loader serves a request whose
      // matched route carries `use`. Observational, never feeds a guard chain.
      findGuardedRoute: makeGuardedRouteMatcher(routes.routeUse),
    });
  ```

- [ ] **Step 7: Re-run and commit.** Run:
  `pnpm exec vitest run packages/server/src/__tests__/route-server-modules.test.ts packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/__tests__/create-server-entry.test.ts`
  Expected: all pass. Then:

  ```
  git add packages/server/src/route-server-modules.ts packages/server/src/loaders-handler.ts packages/server/src/create-server-entry.ts packages/server/src/__tests__/route-server-modules.test.ts packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/__tests__/create-server-entry.test.ts
  git commit -m "feat(server): dev-warn when a bare loader serves a request on a guarded route

  A bare defineLoader under a gated subtree serves its RPC with no page
  tier and no signal that the route's guards were skipped. The loaders
  handler now takes an optional findGuardedRoute matcher (built from the
  manifest routeUse via the new makeGuardedRouteMatcher) and, in dev,
  warns once per bare loader whose request path matches a route carrying
  page-level use (issue #260, warning half of finding 1; the subtree
  binder API stays deferred).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 5: Docs: error masking, dev passthrough, and the new dev diagnostics

Docs must describe the behavior shipped in Tasks 1-4. Three pages change: `actions.mdx` (error handling section + payload-typing caveat), `loaders.mdx` (bare-loader warning sentence), `streaming.mdx` (SSE frame masking). Describe what IS; no migration breadcrumbs, no "previously/formerly" phrasing.

**Files**

- Modify: `apps/site/src/pages/docs/actions.mdx` (after the "Reading the code client-side" subsection, before the `## Calling programmatically` heading ~line 306; and the closing paragraph of "### Typing the payload" ~line 60)
- Modify: `apps/site/src/pages/docs/loaders.mdx` (the "A route-independent loader is not route-gated." paragraph, ~line 101)
- Modify: `apps/site/src/pages/docs/streaming.mdx` (the `## Errors` section, ~line 141-164, after the code block and before `## Abort and cleanup`)

**Interfaces**

Consumes: the exact runtime behavior from Tasks 1-4 (masks `Action failed` / `Stream failed`, dev passthrough, once-per-unit dev warnings). Produces: MDX prose only; no code moves, no nav changes (headings are picked up automatically).

Steps:

- [ ] **Step 1: actions.mdx: add the error-handling section.** Insert the following immediately before the line `## Calling programmatically: \`useAction(stub)\`` (~line 306), separated by a blank line on each side:

  ```mdx
  ## Error handling

  An action that throws anything other than a framework outcome (`deny`, `redirect`, a timeout) responds 500 with the uniform error envelope. In production the envelope's `message` is always `Action failed`: a thrown error's text can carry PII or internal detail, so it never reaches the client. In dev the real message passes through so the failure is readable in the network tab, and the server console prints a hint naming the action.

  Because of the production mask, a plain thrown `Error` is the wrong way to reject bad input or denied access on purpose. Throw `deny(status, message)` instead; a deny's status, message, and `data` reach the client in every mode:

  ```ts
  import { defineAction, deny } from 'hono-preact';

  export const serverActions = {
    publish: defineAction(
      async (ctx, payload) => {
        const user = await currentUser(ctx.c);
        if (!user) throw deny(401, 'Sign in to publish.');
        // ...
      },
      { input: PublishSchema }
    ),
  };
  ```

  The same policy applies to route-bound chain resolution: when a route-bound action cannot resolve its page-use chain, the 500 message carries the resolver's detail only in dev.
  ```

  Note for the implementer: the fenced ` ```ts ` block above is part of the inserted MDX; keep it verbatim.

- [ ] **Step 2: actions.mdx: caveat under "Typing the payload".** After the paragraph ending `...rather than letting an untyped value through.` (~line 60), add a new paragraph:

  ```mdx
  Only the schema form validates at runtime. The two type-only forms (explicit generics, annotated parameters) assert a shape the wire does not enforce: the client payload reaches the handler as-is. In dev, the server warns once per action when an action without an `input` schema receives a non-empty object payload.
  ```

- [ ] **Step 3: loaders.mdx: bare-loader warning sentence.** In the paragraph beginning `A route-independent loader is not route-gated.` (~line 101), append this sentence at the end of the paragraph (after `...See [Middleware](/docs/middleware) for the three layers.`):

  ```mdx
  In dev, the server warns once per loader when a route-independent loader serves a request whose matched route declares `use`, so an ungated RPC under a guarded subtree is visible in the console.
  ```

- [ ] **Step 4: streaming.mdx: frame masking.** In the `## Errors` section, after the closing ` ``` ` of the `StatsView` code block and before `## Abort and cleanup` (~line 164), insert:

  ```mdx
  A mid-stream throw reaches the client as a terminal error event on the wire. In production its message is masked as `Stream failed`, mirroring the non-streaming `Loader failed` and `Action failed` masking; in dev the real message and error name pass through. An expected, user-facing terminal state should be yielded as data the consumer understands rather than thrown.
  ```

- [ ] **Step 5: Verify docs tests and commit.** Run:
  `pnpm exec vitest run apps/site/src/pages/docs/__tests__`
  Expected: all pass (these are structural gates; the MDX edits add prose and one self-contained code block). Then:

  ```
  git add apps/site/src/pages/docs/actions.mdx apps/site/src/pages/docs/loaders.mdx apps/site/src/pages/docs/streaming.mdx
  git commit -m "docs: cover server error masking and the new dev diagnostics

  Documents the Action failed production mask with dev passthrough and
  the deny(status, message) idiom, the dev warning for schema-less
  actions receiving object payloads, the dev warning for bare loaders
  serving guarded routes, and the Stream failed masking on SSE error
  frames.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 6: Site demos: schemas + deny() idiom, then full CI parity

Make the demos exemplary for the new diagnostics: `login.server.ts` throws a plain `Error` (masked in prod, now also triggers the dev hint) and has no input schema; `project-board.server.ts` `patchTask`/`deleteTask` take client payloads with no input schema, `deleteTask` has no auth check, and `createTask` throws a plain `Error` for its auth denial. Fix all of it with valibot schemas and `deny()`.

**Files**

- Create: `apps/site/src/pages/demo/login-schema.ts`
- Create: `apps/site/src/pages/demo/__tests__/login-schema.test.ts`
- Create: `apps/site/src/pages/demo/__tests__/task-schema.test.ts`
- Modify: `apps/site/src/pages/demo/task-schema.ts` (append two schemas)
- Modify: `apps/site/src/pages/demo/login.server.ts`
- Modify: `apps/site/src/pages/demo/project-board.server.ts`

**Interfaces**

- `LoginSchema` (new file, valibot): `{ email: string (trimmed, lowercased), name: string (trimmed, defaults to '') }`. Format checking stays in the action as a `deny(400, ...)` so the demo showcases the deny idiom the new dev hint points at.
- `PatchTaskSchema`: `{ taskId: string (min length 1), status?: TaskStatus, priority?: TaskPriority }`.
- `DeleteTaskSchema`: `{ taskId: string (min length 1) }`.
- Action signatures switch from explicit generics to schema-inferred payloads; result types stay literal via explicit `Promise<...>` return annotations. Call sites (`apps/site/src/components/demo/Board.tsx` sends `{ taskId, status? , priority? }` and `{ taskId }`; `login.tsx` posts FormData with `email`, `name`) keep the same payload shapes, so no client changes are needed.

Steps:

- [ ] **Step 1: Write the failing schema tests.** Create `apps/site/src/pages/demo/__tests__/task-schema.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import * as v from 'valibot';
  import { PatchTaskSchema, DeleteTaskSchema } from '../task-schema.js';

  describe('PatchTaskSchema', () => {
    it('accepts a status-only patch', () => {
      const r = v.safeParse(PatchTaskSchema, { taskId: 't-1', status: 'done' });
      expect(r.success).toBe(true);
    });

    it('accepts a priority-only patch', () => {
      const r = v.safeParse(PatchTaskSchema, {
        taskId: 't-1',
        priority: 'high',
      });
      expect(r.success).toBe(true);
    });

    it('rejects an unknown status', () => {
      const r = v.safeParse(PatchTaskSchema, {
        taskId: 't-1',
        status: 'archived',
      });
      expect(r.success).toBe(false);
    });

    it('rejects a missing taskId', () => {
      const r = v.safeParse(PatchTaskSchema, { status: 'done' });
      expect(r.success).toBe(false);
    });
  });

  describe('DeleteTaskSchema', () => {
    it('accepts a taskId', () => {
      const r = v.safeParse(DeleteTaskSchema, { taskId: 't-1' });
      expect(r.success).toBe(true);
    });

    it('rejects an empty taskId', () => {
      const r = v.safeParse(DeleteTaskSchema, { taskId: '' });
      expect(r.success).toBe(false);
    });
  });
  ```

  Create `apps/site/src/pages/demo/__tests__/login-schema.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import * as v from 'valibot';
  import { LoginSchema } from '../login-schema.js';

  describe('LoginSchema', () => {
    it('trims and lowercases the email', () => {
      const r = v.parse(LoginSchema, {
        email: '  Alice@Example.COM ',
        name: '',
      });
      expect(r.email).toBe('alice@example.com');
    });

    it('defaults a missing name to the empty string', () => {
      const r = v.parse(LoginSchema, { email: 'a@b.co' });
      expect(r.name).toBe('');
    });

    it('rejects a non-string email', () => {
      const r = v.safeParse(LoginSchema, { email: 42 });
      expect(r.success).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run and observe failures.** Run:
  `pnpm exec vitest run apps/site/src/pages/demo/__tests__`
  Expected: both files fail to resolve their imports (`PatchTaskSchema`/`DeleteTaskSchema` not exported; `../login-schema.js` does not exist).

- [ ] **Step 3: Implement the schemas.** Append to `apps/site/src/pages/demo/task-schema.ts`:

  ```ts
  // Patching a task: one action drives both drag moves and priority changes,
  // so both fields are optional; `taskId` is always required.
  export const PatchTaskSchema = v.object({
    taskId: v.pipe(v.string(), v.minLength(1)),
    status: v.optional(v.picklist(STATUSES, 'Status must be a known column')),
    priority: v.optional(
      v.picklist(PRIORITIES, 'Priority must be a known level')
    ),
  });

  // Deleting a task: just the id.
  export const DeleteTaskSchema = v.object({
    taskId: v.pipe(v.string(), v.minLength(1)),
  });
  ```

  Create `apps/site/src/pages/demo/login-schema.ts`:

  ```ts
  import * as v from 'valibot';

  // The login form posts FormData, so both fields arrive as strings. The
  // schema normalizes shape (trim, lowercase, default name); the email format
  // check lives in the action as a deny(400, ...) so the demo shows the deny
  // idiom for an intentional denial.
  export const LoginSchema = v.object({
    email: v.pipe(v.string(), v.trim(), v.toLowerCase()),
    name: v.fallback(v.pipe(v.string(), v.trim()), ''),
  });
  ```

  Re-run the Step 2 command. Expected: all pass.

- [ ] **Step 4: Rewrite `login.server.ts`.** Replace the full contents of `apps/site/src/pages/demo/login.server.ts` with:

  ```ts
  import { defineAction, deny, redirect } from 'hono-preact';
  import { upsertUser } from '../../demo/data.js';
  import { signIn, signOut } from '../../demo/session.js';
  import { LoginSchema } from './login-schema.js';

  export const serverActions = {
    login: defineAction(
      async (ctx, input) => {
        // The schema already trimmed and lowercased; this is the business
        // check, thrown as deny so the form receives a 400 with a message it
        // renders (a plain thrown Error would be masked as 'Action failed'
        // in production).
        if (!input.email || !input.email.includes('@')) {
          throw deny(400, 'A valid email is required.');
        }
        const name = input.name || input.email.split('@')[0];
        const user = upsertUser(input.email, name);
        await signIn(ctx.c, user);
        throw redirect('/demo/projects');
      },
      { input: LoginSchema }
    ),

    logout: defineAction<{}, { ok: true }>(async (ctx) => {
      signOut(ctx.c);
      return { ok: true };
    }),
  };
  ```

- [ ] **Step 5: Rewrite the `serverActions` block of `project-board.server.ts`.** In `apps/site/src/pages/demo/project-board.server.ts`:

  (a) Change the first import line to include `deny`:

  ```ts
  import { defineAction, deny, serverRoute } from 'hono-preact';
  ```

  (b) In the `../../demo/data.js` import, remove the now-unused `TaskStatus` and `TaskPriority` type names (keep `Task`, `Project`, `User` and all value imports).

  (c) Change the schema import to:

  ```ts
  import {
    NewTaskSchema,
    PatchTaskSchema,
    DeleteTaskSchema,
  } from './task-schema.js';
  ```

  (d) Replace the entire `export const serverActions = { ... };` block with:

  ```ts
  export const serverActions = {
    createTask: defineAction(
      async (ctx, input) => {
        const user = await currentUser(ctx.c);
        if (!user) throw deny(401, 'Sign in to create tasks.');
        // Schema coerces and trims; values are already clean.
        const created = createTask(user, input);
        publishActivity(taskCreatedEvent(created, user.name));
        return { id: created.id };
      },
      { input: NewTaskSchema }
    ),

    // One action drives both moves and priority changes so a single
    // useOptimisticAction can cover drag + menu interactions. The schema
    // types the payload; no generics needed.
    patchTask: defineAction(
      async (ctx, input): Promise<{ ok: true }> => {
        const user = await currentUser(ctx.c);
        if (input.status === 'done') {
          await assertCanMoveToDone(input.taskId, user?.id);
        }
        if (input.status)
          setTaskStatus(input.taskId, input.status, user?.id ?? null);
        if (input.priority) setTaskPriority(input.taskId, input.priority);
        if (input.status) {
          const task = getTask(input.taskId);
          if (task) {
            publishActivity(
              taskMovedEvent(task, input.status, user?.name ?? 'someone')
            );
          }
        }
        return { ok: true };
      },
      { input: PatchTaskSchema }
    ),

    deleteTask: defineAction(
      async (ctx, input): Promise<{ ok: true }> => {
        const user = await currentUser(ctx.c);
        if (!user) throw deny(401, 'Sign in to delete tasks.');
        deleteTask(input.taskId);
        return { ok: true };
      },
      { input: DeleteTaskSchema }
    ),
  };
  ```

- [ ] **Step 6: Build the framework and typecheck the tree.** The site resolves framework types through `dist/`, and Tasks 1-4 changed framework source, so rebuild first:

  ```
  pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
  pnpm typecheck
  ```

  Expected: both succeed. If typecheck flags the `patchTask`/`deleteTask` call sites in `apps/site/src/components/demo/Board.tsx`, the schema output types do not line up with the payload shapes described in Interfaces; fix the schema (not the component) so the wire shape is unchanged.

- [ ] **Step 7: Run the full local CI parity sequence and commit.** Run, in order:

  ```
  pnpm gen:agents-corpus
  pnpm format:check
  pnpm test:types
  pnpm test:coverage
  pnpm test:integration
  pnpm --filter site build
  ```

  If `format:check` fails, run `pnpm format` and include the result in the commit. Expected: all green. Then:

  ```
  git add apps/site/src/pages/demo/login-schema.ts apps/site/src/pages/demo/login.server.ts apps/site/src/pages/demo/task-schema.ts apps/site/src/pages/demo/project-board.server.ts apps/site/src/pages/demo/__tests__/login-schema.test.ts apps/site/src/pages/demo/__tests__/task-schema.test.ts
  git commit -m "feat(site): validate demo action payloads and use deny() for denials

  login now validates through LoginSchema and denies bad emails with
  deny(400) instead of a plain Error that production masks as 'Action
  failed'; project-board's patchTask/deleteTask gain input schemas
  (PatchTaskSchema/DeleteTaskSchema), deleteTask gains the missing auth
  check, and createTask's auth denial becomes deny(401). The demos no
  longer trip the framework's new dev diagnostics (issue #260,
  finding 5).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

  If any earlier task skipped formatting fallout, `pnpm format` may touch files from Tasks 1-5; commit those fixes separately as `chore: format` with the same trailer.

---

## Self-review notes

- Spec coverage: item 1 (actions dev passthrough + deny hint) = Task 1; item 2 (SSE prod masking) = Task 2; item 3 (schema-less action dev warning, once per action, no `.unchecked`) = Task 3; item 4 (bare-loader-under-gated-route dev warning, no binder API) = Task 4; item 5 (demos) = Task 6; docs sync = Task 5.
- All warn-count assertions filter by substring (`deny(status, message)`, `input schema`, `bare loader`) so the three diagnostics coexist in one dev request without breaking each other's tests.
- Names used consistently across tasks: `dev` (both handlers), `warnPlainErrorThrown`, `warnMissingInputSchema`, `warnedMissingSchema`, `warnBareLoaderOnGuardedRoute`, `warnedBareGuarded`, `findGuardedRoute`, `makeGuardedRouteMatcher`, `LoginSchema`, `PatchTaskSchema`, `DeleteTaskSchema`.
- The only casts introduced are `as never` in test fixtures, matching the exact pre-existing style in `page-actions-handler.test.ts` (lines 335, 337).
