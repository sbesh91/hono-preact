# Outcome Semantics Consolidation (PR 1 of Section A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One implementation of the `__outcome` wire format on the client (shared decoder for `Form` and `useAction`) and one server module for outcome-to-response translation, replacing four pasted translators and two divergent client parsers.

**Architecture:** The decoder joins the encoder in `packages/iso/src/internal/action-envelope.ts`, returning a `DecodedEnvelope` discriminated union; `Form` and `useAction` become policy switches over it. On the server, `translateRootOutcome` and `translateOutcomeForLoader` move into a new `packages/server/src/outcome-translation.ts` alongside a shared `applyOutcomeHeaders` helper; the "render outcome is page-scope only" defense message becomes one exported constant in iso internal.

**Tech Stack:** TypeScript, Preact, Hono, vitest (happy-dom for component tests). Test command: `pnpm exec vitest run <file>` from the package directory.

**Spec:** `docs/superpowers/specs/2026-06-10-semantics-consolidation-design.md`

**Branch:** `feat/outcome-semantics-consolidation` (PR 1 of 3; PRs 2 and 3 get their own plans after this merges).

**Behavior changes (deliberate, from the spec):**
1. `Form` handles a `timeout` envelope as a real timeout error result (`Request timed out after <n>ms`) instead of the `Unexpected outcome: timeout` fallthrough.
2. Truthy-primitive JSON bodies (e.g. `5`, `"x"`) now count as malformed in both consumers (Form reloads, useAction throws the malformed error). Today Form reloads only on falsy bodies and both treat truthy primitives as unknown outcomes. Pathological inputs; unified under "non-object body = malformed".

Everything else, including all server status codes, response shapes, and error message strings, is behavior-preserving.

**Two spec notes discovered during planning:**
- The spec's "cross-origin redirect detection moves in as a shared helper" is already true: both consumers call `assignSafeRedirect` from `packages/iso/src/internal/safe-redirect.ts`. No work needed; the consumers keep calling it.
- The spec's `rejectRenderOutcome()` helper lands as the `RENDER_PAGE_SCOPE_MESSAGE` constant instead: each channel's rejection response has a different shape (`c.text` vs `c.json` vs envelope body), so a shared function would need channel parameters for no gain. The constant is the single copy of the defense.

---

### Task 1: Envelope decoder in iso internal

**Files:**
- Modify: `packages/iso/src/internal/action-envelope.ts`
- Modify: `packages/iso/src/internal.ts` (barrel: export the new message constant)
- Test: `packages/iso/src/__tests__/action-envelope.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/iso/src/__tests__/action-envelope.test.ts` (it already imports `describe, expect, it` from vitest and tests `serializeActionOutcome`):

```ts
import {
  decodeActionResponse,
  RENDER_PAGE_SCOPE_MESSAGE,
  serializeActionOutcome,
} from '../internal/action-envelope.js';
```

(Merge with the file's existing import from the same module; keep one import statement.)

```ts
function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('decodeActionResponse', () => {
  it('decodes success with its data', async () => {
    expect(
      await decodeActionResponse(
        jsonRes({ __outcome: 'success', data: { id: 1 } })
      )
    ).toEqual({ kind: 'success', data: { id: 1 } });
  });

  it('decodes redirect with a string `to`', async () => {
    expect(
      await decodeActionResponse(
        jsonRes({ __outcome: 'redirect', to: '/next', status: 302 })
      )
    ).toEqual({ kind: 'redirect', to: '/next' });
  });

  it('treats redirect without a string `to` as unknown', async () => {
    expect(
      await decodeActionResponse(jsonRes({ __outcome: 'redirect' }))
    ).toEqual({ kind: 'unknown', outcome: 'redirect', message: undefined });
  });

  it('decodes deny, carrying status, message, and data', async () => {
    expect(
      await decodeActionResponse(
        jsonRes(
          { __outcome: 'deny', status: 403, message: 'no', data: { x: 1 } },
          403
        )
      )
    ).toEqual({ kind: 'deny', status: 403, message: 'no', data: { x: 1 } });
  });

  it('falls back to the HTTP status and a derived message on a bare deny', async () => {
    expect(
      await decodeActionResponse(jsonRes({ __outcome: 'deny' }, 422))
    ).toEqual({
      kind: 'deny',
      status: 422,
      message: 'Request denied (422)',
      data: undefined,
    });
  });

  it('decodes error with a message fallback', async () => {
    expect(await decodeActionResponse(jsonRes({ __outcome: 'error' }))).toEqual(
      { kind: 'error', message: 'Action failed' }
    );
  });

  it('decodes timeout with a numeric timeoutMs', async () => {
    expect(
      await decodeActionResponse(
        jsonRes({ __outcome: 'timeout', timeoutMs: 5000 }, 504)
      )
    ).toEqual({ kind: 'timeout', timeoutMs: 5000 });
  });

  it('treats timeout without a numeric timeoutMs as unknown', async () => {
    expect(
      await decodeActionResponse(jsonRes({ __outcome: 'timeout' }, 504))
    ).toEqual({ kind: 'unknown', outcome: 'timeout', message: undefined });
  });

  it('returns unknown for an unrecognized outcome, carrying the env message', async () => {
    expect(
      await decodeActionResponse(
        jsonRes({ __outcome: 'whatever', message: 'm' })
      )
    ).toEqual({ kind: 'unknown', outcome: 'whatever', message: 'm' });
  });

  it('returns unknown for an envelope object without __outcome', async () => {
    expect(await decodeActionResponse(jsonRes({}))).toEqual({
      kind: 'unknown',
      outcome: undefined,
      message: undefined,
    });
  });

  it('returns malformed for a non-JSON body, carrying the HTTP status', async () => {
    const res = new Response('<!doctype html><p>oops</p>', { status: 200 });
    expect(await decodeActionResponse(res)).toEqual({
      kind: 'malformed',
      httpStatus: 200,
    });
  });

  it('returns malformed for a JSON null body', async () => {
    expect(await decodeActionResponse(jsonRes(null, 500))).toEqual({
      kind: 'malformed',
      httpStatus: 500,
    });
  });

  it('returns malformed for a primitive JSON body', async () => {
    expect(await decodeActionResponse(jsonRes(5))).toEqual({
      kind: 'malformed',
      httpStatus: 200,
    });
  });
});

describe('RENDER_PAGE_SCOPE_MESSAGE', () => {
  it('is the message serializeActionOutcome emits for a render outcome', () => {
    const env = serializeActionOutcome({
      kind: 'outcome',
      outcome: {
        __outcome: 'render',
        Component: () => null,
      },
    });
    expect(env.body).toEqual({
      __outcome: 'error',
      message: RENDER_PAGE_SCOPE_MESSAGE,
    });
    expect(env.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/iso`: `pnpm exec vitest run src/__tests__/action-envelope.test.ts`
Expected: FAIL with `decodeActionResponse` / `RENDER_PAGE_SCOPE_MESSAGE` not exported.

- [ ] **Step 3: Implement the decoder**

In `packages/iso/src/internal/action-envelope.ts`, add after the existing type declarations:

```ts
/**
 * The defense-in-depth message for `render` outcomes reaching a channel
 * that cannot host them (actions, loaders, root middleware). One copy;
 * the server translators import it from `@hono-preact/iso/internal`.
 */
export const RENDER_PAGE_SCOPE_MESSAGE = 'render outcome is page-scope only';

/**
 * The decoded client-side view of an action response. `unknown` is an
 * envelope object with an unrecognized `__outcome` (consumers surface it
 * as an error); `malformed` is a body that is not an envelope object at
 * all (consumers own the policy: <Form> reloads as a PE fallback,
 * useAction throws).
 */
export type DecodedEnvelope =
  | { kind: 'success'; data: unknown }
  | { kind: 'redirect'; to: string }
  | { kind: 'deny'; status: number; message: string; data?: unknown }
  | { kind: 'error'; message: string }
  | { kind: 'timeout'; timeoutMs: number }
  | {
      kind: 'unknown';
      outcome: string | undefined;
      message: string | undefined;
    }
  | { kind: 'malformed'; httpStatus: number };

export async function decodeActionResponse(
  res: Response
): Promise<DecodedEnvelope> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: 'malformed', httpStatus: res.status };
  }
  if (raw === null || typeof raw !== 'object') {
    return { kind: 'malformed', httpStatus: res.status };
  }
  // Parsing untrusted JSON is the sanctioned cast boundary; this is the one
  // place the wire shape is asserted, so the consumers never cast.
  const env = raw as {
    __outcome?: unknown;
    data?: unknown;
    to?: unknown;
    status?: unknown;
    message?: unknown;
    timeoutMs?: unknown;
  };
  switch (env.__outcome) {
    case 'success':
      return { kind: 'success', data: env.data };
    case 'redirect':
      if (typeof env.to === 'string') return { kind: 'redirect', to: env.to };
      break;
    case 'deny': {
      const status = typeof env.status === 'number' ? env.status : res.status;
      return {
        kind: 'deny',
        status,
        message:
          typeof env.message === 'string'
            ? env.message
            : `Request denied (${status})`,
        data: env.data,
      };
    }
    case 'error':
      return {
        kind: 'error',
        message:
          typeof env.message === 'string' ? env.message : 'Action failed',
      };
    case 'timeout':
      if (typeof env.timeoutMs === 'number') {
        return { kind: 'timeout', timeoutMs: env.timeoutMs };
      }
      break;
  }
  return {
    kind: 'unknown',
    outcome: typeof env.__outcome === 'string' ? env.__outcome : undefined,
    message: typeof env.message === 'string' ? env.message : undefined,
  };
}
```

In the same file, replace the render-branch literal in `serializeActionOutcome`:

```ts
  // 'render' outcome is page-scope only; should never reach an action.
  return {
    body: { __outcome: 'error', message: RENDER_PAGE_SCOPE_MESSAGE },
    status: 500,
    headers: undefined,
  };
```

In `packages/iso/src/internal.ts`, extend the existing export block from `./internal/action-envelope.js`:

```ts
export {
  serializeActionOutcome,
  decodeActionResponse,
  RENDER_PAGE_SCOPE_MESSAGE,
  type ActionEnvelope,
  type ActionResolution,
  type SerializedEnvelope,
  type DecodedEnvelope,
} from './internal/action-envelope.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/iso`: `pnpm exec vitest run src/__tests__/action-envelope.test.ts`
Expected: PASS (all serialize + decode cases).

Also run `pnpm exec vitest run src/__tests__/internal.test.ts` (the barrel-surface test); if it asserts an exact export list, add the three new names there.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/action-envelope.ts packages/iso/src/internal.ts packages/iso/src/__tests__/action-envelope.test.ts packages/iso/src/__tests__/internal.test.ts
git commit -m "feat(iso): add decodeActionResponse, the single envelope decoder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Drop `internal.test.ts` from the add list if it needed no change.)

---

### Task 2: Form onto the decoder, with real timeout handling

**Files:**
- Modify: `packages/iso/src/form.tsx:68-173` (the `handleSubmit` callback)
- Test: `packages/iso/src/__tests__/form.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('<Form>', ...)` block of `packages/iso/src/__tests__/form.test.tsx`:

```ts
  it('writes a timeout error result instead of an unknown-outcome error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ __outcome: 'timeout', timeoutMs: 5000 }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const stub = makeStub();
    const { container } = render(
      <Form action={stub}>
        <button type="submit">go</button>
      </Form>
    );
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    const stored = getLastActionResult({
      __module: stub.__module,
      __action: stub.__action,
    });
    expect(stored?.kind).toBe('error');
    if (stored?.kind === 'error') {
      expect(stored.message).toBe('Request timed out after 5000ms');
    }
    vi.restoreAllMocks();
  });

  it('reloads the page on a malformed (non-envelope) body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html><p>not an envelope</p>', { status: 200 })
    );
    const reloadSpy = vi
      .spyOn(window.location, 'reload')
      .mockImplementation(() => {});
    const stub = makeStub();
    const { container } = render(
      <Form action={stub}>
        <button type="submit">go</button>
      </Form>
    );
    fireEvent.submit(container.querySelector('form')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(
      getLastActionResult({ __module: stub.__module, __action: stub.__action })
    ).toBeUndefined();
    vi.restoreAllMocks();
  });
```

Note: if happy-dom rejects spying on `window.location.reload` (non-configurable), replace the spy with `Object.defineProperty(window.location, 'reload', { value: vi.fn(), configurable: true })` style stubbing and restore it in a `finally`. Check what `getLastActionResult` returns for a never-set key (`undefined` vs `null`) and match the assertion; the deny test in this file shows the read pattern.

- [ ] **Step 2: Run the tests to verify the timeout one fails**

Run from `packages/iso`: `pnpm exec vitest run src/__tests__/form.test.tsx`
Expected: the timeout test FAILS (message is `Unexpected outcome: timeout` today); the malformed test should already PASS (it pins existing behavior so the rewrite can't drop it).

- [ ] **Step 3: Rewire handleSubmit onto the decoder**

In `packages/iso/src/form.tsx`, add the import:

```ts
import { decodeActionResponse } from './internal/action-envelope.js';
```

Replace the body of the `try` block in `handleSubmit` (currently lines 90-159: the `fetch` call, the `env` parse/cast, and the outcome if-chain) with:

```ts
        const res = await fetch(target, {
          method: 'POST',
          body: fd,
          headers: { Accept: 'application/json' },
        });
        const decoded = await decodeActionResponse(res);
        switch (decoded.kind) {
          case 'malformed':
            // PE fallback policy: a non-envelope body means the POST landed
            // somewhere that didn't speak the action protocol; reload so the
            // server-rendered state wins.
            handle?.revert();
            if (typeof window !== 'undefined') window.location.reload();
            return;
          case 'redirect': {
            const navigated = assignSafeRedirect(decoded.to);
            if (navigated) {
              handle?.settle();
              return;
            }
            // Cross-origin: revert optimistic, surface as error result so
            // useActionResult sees it.
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message: `Refused cross-origin redirect to ${decoded.to}`,
              submittedPayload: payload,
            });
            return;
          }
          case 'success':
            handle?.settle();
            setLastActionResult(moduleKey, actionName, {
              kind: 'success',
              data: decoded.data,
              submittedPayload: payload,
            });
            return;
          case 'deny':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'deny',
              status: decoded.status,
              message: decoded.message,
              data: decoded.data,
              submittedPayload: payload,
            });
            return;
          case 'error':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message: decoded.message,
              submittedPayload: payload,
            });
            return;
          case 'timeout':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message: `Request timed out after ${decoded.timeoutMs}ms`,
              submittedPayload: payload,
            });
            return;
          case 'unknown':
            handle?.revert();
            setLastActionResult(moduleKey, actionName, {
              kind: 'error',
              message:
                decoded.message ??
                `Unexpected outcome: ${decoded.outcome ?? 'unknown'}`,
              submittedPayload: payload,
            });
            return;
        }
```

The `catch`/`finally` blocks and everything before the `fetch` stay unchanged. The deny/error message fallbacks (`Request denied (...)`, `Action failed`) now come from the decoder, so they do not reappear here.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/iso`: `pnpm exec vitest run src/__tests__/form.test.tsx src/__tests__/use-action-result.test.tsx src/__tests__/use-form-status.test.tsx src/__tests__/optimistic-action.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/form.tsx packages/iso/src/__tests__/form.test.tsx
git commit -m "feat(iso): Form decodes via decodeActionResponse, handles timeout

Form now reports a timeout envelope as 'Request timed out after Nms'
instead of the unknown-outcome fallthrough. Reload-on-malformed stays
as the explicit PE fallback policy.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: useAction onto the decoder (behavior-preserving)

**Files:**
- Modify: `packages/iso/src/action.ts:405-478` (the non-streaming "uniform envelope path" in `mutate`)
- Test: existing `packages/iso/src/__tests__/action.test.tsx` and `packages/iso/src/__tests__/use-action-timeout.test.ts` (no new tests; staying green is the check)

- [ ] **Step 1: Rewire the envelope branch**

In `packages/iso/src/action.ts`, add to the existing import from `./internal/action-envelope.js` if present, otherwise add:

```ts
import { decodeActionResponse } from './internal/action-envelope.js';
```

Replace the `else` branch (the comment `// Uniform envelope path...` through the closing `else { throw new Error(\`Unknown action outcome: ...\`) }`) with:

```ts
        } else {
          // Uniform envelope path. All non-streaming responses carry a JSON
          // body shaped as { __outcome, ... } regardless of HTTP status.
          const decoded = await decodeActionResponse(response);
          if (decoded.kind === 'malformed') {
            throw new Error(`Malformed envelope (HTTP ${decoded.httpStatus})`);
          }
          if (decoded.kind === 'success') {
            const data = decoded.data as TResult;
            setData(data);
            invokeSuccess(data);
            finalResult = data;
            recordOutcome(currentStub.__module, currentStub.__action, {
              kind: 'success',
              data,
              submittedPayload: payload,
            });
            outcomeRecorded = true;
          } else if (decoded.kind === 'redirect') {
            if (assignSafeRedirect(decoded.to)) {
              // Navigation issued; this promise never settles.
              return await new Promise<MutateResult<TResult>>(() => {});
            }
            // Cross-origin: surface as an error so the caller can handle it.
            throw new Error(`Refused cross-origin redirect to ${decoded.to}`);
          } else if (decoded.kind === 'deny') {
            recordOutcome(currentStub.__module, currentStub.__action, {
              kind: 'deny',
              status: decoded.status,
              message: decoded.message,
              data: decoded.data,
              submittedPayload: payload,
            });
            outcomeRecorded = true;
            throw new Error(decoded.message);
          } else if (decoded.kind === 'timeout') {
            recordOutcome(currentStub.__module, currentStub.__action, {
              kind: 'error',
              message: `Request timed out after ${decoded.timeoutMs}ms`,
              submittedPayload: payload,
            });
            outcomeRecorded = true;
            throw new TimeoutError(decoded.timeoutMs);
          } else if (decoded.kind === 'error') {
            recordOutcome(currentStub.__module, currentStub.__action, {
              kind: 'error',
              message: decoded.message,
              submittedPayload: payload,
            });
            outcomeRecorded = true;
            throw new Error(decoded.message);
          } else {
            throw new Error(`Unknown action outcome: ${decoded.outcome}`);
          }
        }
```

Note the pre-existing `data as TResult` cast stays: it is the documented `useData() as T`-class seam, out of scope here. The `env` type literal and its `as typeof env` cast are deleted; the decoder owns the JSON-boundary cast now. The streaming branch above this code is untouched.

- [ ] **Step 2: Run the action test suites**

Run from `packages/iso`: `pnpm exec vitest run src/__tests__/action.test.tsx src/__tests__/use-action-timeout.test.ts src/__tests__/optimistic-action.test.tsx src/__tests__/optimistic-action-transition.test.ts`
Expected: PASS unchanged. If a test asserted `Unknown action outcome: undefined` for a primitive-body response, it now sees `Malformed envelope (HTTP ...)`; per the spec that unification is accepted, update the assertion.

- [ ] **Step 3: Run the full iso suite**

Run from `packages/iso`: `pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/action.ts
git commit -m "refactor(iso): useAction decodes via decodeActionResponse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Server outcome-translation module

**Files:**
- Create: `packages/server/src/outcome-translation.ts`
- Modify: `packages/server/src/render.tsx:52-73` (delete local `translateRootOutcome`, import it)
- Modify: `packages/server/src/loaders-handler.ts:146-184` (delete local `translateOutcomeForLoader`, import it)
- Modify: `packages/server/src/page-action-handler.ts:318-338` (use `applyOutcomeHeaders` for the two header loops)
- Test: existing server suites (`render.test.tsx`, `render-honocontext.test.tsx`, `loaders-handler*.test.ts`, `page-action-handler.test.ts`); staying green is the check

- [ ] **Step 1: Rebuild iso dist**

The server package resolves `@hono-preact/iso/internal` through `dist/`, and Task 1 added `RENDER_PAGE_SCOPE_MESSAGE` there. From the repo root:

```bash
pnpm --filter '@hono-preact/iso' build
```

- [ ] **Step 2: Create the module**

`packages/server/src/outcome-translation.ts`:

```ts
import type { Context } from 'hono';
import type { Outcome } from '@hono-preact/iso';
import { RENDER_PAGE_SCOPE_MESSAGE } from '@hono-preact/iso/internal';

/** Apply an outcome's optional headers to the HTTP response. */
export function applyOutcomeHeaders(
  c: Context,
  headers: Record<string, string> | undefined
): void {
  if (!headers) return;
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
}

// Outcome translation for the root chain dispatched around prerender. The
// root layer (appConfig.use) only legitimately produces `redirect` or
// `deny`; a `render` outcome is page-scope and must not flow through here.
// Defense-in-depth: surface programmer error as a 500 rather than crash.
export function translateRootOutcome(c: Context, outcome: Outcome): Response {
  if (outcome.__outcome === 'redirect') {
    applyOutcomeHeaders(c, outcome.headers);
    return c.redirect(outcome.to, outcome.status);
  }
  if (outcome.__outcome === 'deny') {
    applyOutcomeHeaders(c, outcome.headers);
    return c.text(outcome.message ?? 'Forbidden', outcome.status);
  }
  return c.text(
    `${RENDER_PAGE_SCOPE_MESSAGE} and cannot be issued by root middleware`,
    500
  );
}

export function translateOutcomeForLoader(
  c: Context,
  outcome: Outcome
): Response {
  if (outcome.__outcome === 'redirect') {
    // Headers from the outcome ride the HTTP response via `c.header()`. They
    // are deliberately NOT embedded in the JSON envelope: the client only
    // reads `to` and calls `window.location.assign(to)`; any embedded
    // headers would be dead bytes the client never inspects.
    applyOutcomeHeaders(c, outcome.headers);
    return c.json(
      {
        __outcome: 'redirect',
        to: outcome.to,
        status: outcome.status,
      },
      200
    );
  }
  if (outcome.__outcome === 'deny') {
    applyOutcomeHeaders(c, outcome.headers);
    return c.json(
      { __outcome: 'deny', message: outcome.message },
      outcome.status
    );
  }
  if (outcome.__outcome === 'timeout') {
    return c.json({ __outcome: 'timeout', timeoutMs: outcome.timeoutMs }, 504);
  }
  // render outcome should never reach the loader RPC; this is defense in depth.
  return c.json(
    {
      __outcome: 'error',
      message: RENDER_PAGE_SCOPE_MESSAGE,
    },
    500
  );
}
```

Do NOT export any of this from the server package index; it is package-internal (the public/internal boundary work is Section B).

- [ ] **Step 3: Rewire the three call sites**

In `packages/server/src/render.tsx`: delete the local `translateRootOutcome` function (lines 52-73, including its leading comment, which moved with it) and add to the imports:

```ts
import { translateRootOutcome } from './outcome-translation.js';
```

In `packages/server/src/loaders-handler.ts`: delete the local `translateOutcomeForLoader` (lines 146-184) and add:

```ts
import { translateOutcomeForLoader } from './outcome-translation.js';
```

In `packages/server/src/page-action-handler.ts`: add `import { applyOutcomeHeaders } from './outcome-translation.js';` and replace the two header loops:

JSON path (currently `if (env.headers) { for ... c.header(k, v); }` around line 320):

```ts
      const env = serializeActionOutcome(resolution);
      applyOutcomeHeaders(c, env.headers);
      return c.json(env.body, env.status);
```

HTML/PE redirect path (currently `if (headers) { for ... }` around line 334):

```ts
      const { to, status, headers } = resolution.outcome;
      applyOutcomeHeaders(c, headers);
      return c.redirect(to, status);
```

- [ ] **Step 4: Run the server suites**

Run from `packages/server`: `pnpm exec vitest run`
Expected: PASS unchanged (the root 500 text and loader JSON bodies are byte-identical to before).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/outcome-translation.ts packages/server/src/render.tsx packages/server/src/loaders-handler.ts packages/server/src/page-action-handler.ts
git commit -m "refactor(server): consolidate outcome translation into one module

translateRootOutcome and translateOutcomeForLoader move to
outcome-translation.ts; the header-application loop and the
render-is-page-scope defense message each have one copy now.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification (CI mirror)

**Files:** none (verification only)

- [ ] **Step 1: Run the six CI steps in order, from the repo root**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all six PASS. If `format:check` fails, run `pnpm format`, re-run `format:check`, and amend or commit the formatting as its own commit. Note: `test:integration` includes a scaffold test that needs network; if offline it can hang or flake, rerun when connected. Never pipe test output through `| tail` (it masks the exit code).

- [ ] **Step 2: Commit any formatting fallout**

```bash
git add -A
git commit -m "chore: pnpm format

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip if the tree is clean.)

---

### Task 6: PR

- [ ] **Step 1: Push the branch and open the PR** (only after every Task 5 step passed and was personally observed)

```bash
git push -u origin feat/outcome-semantics-consolidation
gh pr create --title "refactor(iso,server): single envelope codec + outcome-translation module" --body "$(cat <<'EOF'
PR 1 of 3 for Section A of the primitives DX review (spec: docs/superpowers/specs/2026-06-10-semantics-consolidation-design.md).

- One client decoder: `decodeActionResponse` joins the encoder in iso's `action-envelope.ts`; `Form` and `useAction` are now policy switches over the decoded union.
- Behavior change: `Form` reports `timeout` envelopes as a real timeout error result (was: unknown-outcome fallthrough). `Form` keeps reload-on-malformed as its explicit PE fallback.
- One server translation module: `translateRootOutcome` / `translateOutcomeForLoader` / `applyOutcomeHeaders` in `outcome-translation.ts`; the "render outcome is page-scope only" defense message has one copy (`RENDER_PAGE_SCOPE_MESSAGE` in iso internal).
- No public surface changes; all server status codes and response shapes unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Deep PR review**

Per the project PR workflow, immediately run a deep review as the first post-open step, including replacement parity: enumerate every branch of the two deleted client parsers and the two moved server translators against the new code via the PR's deletion diff (do not trust the new code's comments).
