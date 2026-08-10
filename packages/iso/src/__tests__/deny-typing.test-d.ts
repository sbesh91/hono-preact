import { describe, it, expectTypeOf } from 'vitest';
import { deny } from '../outcomes.js';
import type { DenyOutcome, Outcome } from '../outcomes.js';
import { defineServerMiddleware } from '../define-middleware.js';
import type {
  ServerMiddleware,
  Scope,
  ServerActionCtx,
} from '../define-middleware.js';
import type { StreamObserver } from '../define-stream-observer.js';
import { defineAction } from '../action.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { MutateResult } from '../action.js';
import type { ActionResult } from '../use-action-result.js';
import type { DenyRecord } from '../internal/deny-record.js';
import type { ValidationIssue } from '../validate.js';

declare function acceptOutcome(outcome: Outcome): void;
declare function requireAction<X>(m: ServerMiddleware<'action', X>): void;
declare function requireAny<X>(m: ServerMiddleware<Scope, X>): void;

describe('deny() data typing', () => {
  it('A: infers TData from the data option', () => {
    const d = deny({ status: 403, message: 'no', data: { reason: 'quota' } });
    expectTypeOf(d).toEqualTypeOf<DenyOutcome<{ reason: string }>>();
  });

  it('A2: a data-free deny collapses to never, so it cannot widen a union', () => {
    expectTypeOf(deny(403, 'no')).toEqualTypeOf<DenyOutcome<never>>();
    expectTypeOf(deny('FORBIDDEN', 'no')).toEqualTypeOf<DenyOutcome<never>>();
  });

  it('A3: the positional forms infer from opts.data too', () => {
    expectTypeOf(
      deny(429, 'slow down', { data: { retryAfterS: 60 } })
    ).toEqualTypeOf<DenyOutcome<{ retryAfterS: number }>>();
    expectTypeOf(
      deny('TOO_MANY_REQUESTS', 'slow down', { data: { retryAfterS: 60 } })
    ).toEqualTypeOf<DenyOutcome<{ retryAfterS: number }>>();
  });

  it('A4: a narrow deny outcome still satisfies the erased Outcome union', () => {
    // Covariant in TData, so a guard's narrow deny still flows everywhere the
    // framework handles the erased `Outcome` union. The call IS the assertion:
    // a regression here is a compile error on this line.
    acceptOutcome(deny(403, 'no', { data: { reason: 'quota' } }));
  });
});

describe('defineServerMiddleware deny inference', () => {
  it('B: the scope-argument form captures the deny type from the fn body', () => {
    const guard = defineServerMiddleware('action', async (ctx, next) => {
      // The indexed-access ServerCtx<S> narrows to exactly one ctx shape.
      expectTypeOf(ctx).toEqualTypeOf<ServerActionCtx>();
      if (Math.random() > 1) {
        return deny({ status: 403, message: 'no', data: { reason: 'q' } });
      }
      await next();
    });
    expectTypeOf(guard).toEqualTypeOf<
      ServerMiddleware<'action', { reason: string }>
    >();
  });

  it('C: a middleware that never denies collapses to never, not unknown', () => {
    const passthrough = defineServerMiddleware('action', async (_ctx, next) => {
      await next();
    });
    expectTypeOf(passthrough).toEqualTypeOf<
      ServerMiddleware<'action', never>
    >();
  });

  it('C2: a redirect-returning middleware does not poison the deny type', () => {
    const gate = defineServerMiddleware('page', async (_ctx, next) => {
      if (Math.random() > 1)
        return {
          __outcome: 'redirect' as const,
          to: '/',
          status: 302 as const,
          headers: undefined,
        };
      await next();
    });
    expectTypeOf(gate).toEqualTypeOf<ServerMiddleware<'page', never>>();
  });

  it('D: the type-argument form keeps its pre-existing erased typing', () => {
    // TypeScript has no partial type-argument inference: naming `S` explicitly
    // forces every remaining parameter to its default, so this spelling CANNOT
    // infer a deny type. The default is `unknown` (not `never`) precisely so
    // the failure mode is a union that degrades to `unknown` rather than one
    // that silently DROPS this middleware's deny data from the union.
    const guard = defineServerMiddleware<'action'>(async (_ctx, next) => {
      if (Math.random() > 1) {
        return deny({ status: 403, message: 'no', data: { reason: 'q' } });
      }
      await next();
    });
    expectTypeOf(guard).toEqualTypeOf<ServerMiddleware<'action', unknown>>();
  });
});

describe('scope variance survives the TDeny parameter (#359 / #362)', () => {
  it('F1: a loader-scoped middleware does not satisfy an action-scoped slot', () => {
    const loaderMw = defineServerMiddleware('loader', async (_ctx, next) => {
      await next();
    });
    // @ts-expect-error the scope tag still gates assignability with TDeny in
    // play: a loader middleware is handed a loader ctx, never an action one.
    requireAction(loaderMw);
  });

  it("F1': a single-scope middleware does not satisfy a general/union-scope slot", () => {
    const loaderMw = defineServerMiddleware('loader', async (_ctx, next) => {
      await next();
    });
    // @ts-expect-error the hazard the bivariance fix closed. Under the buggy
    // conditional-in-check-position `ServerCtx<S>` spelling both of TS's
    // variance probes fall through to one branch, `ServerMiddleware<S>`
    // measures BIVARIANT in `S`, and this narrow middleware would WRONGLY be
    // accepted into an all-scope slot the dispatcher may hand a page or
    // action ctx. The indexed access keeps it contravariant.
    requireAny(loaderMw);
  });

  it('F2: an all-scope middleware still flows INTO a single-scope slot', () => {
    const anyMw = defineServerMiddleware(async (_ctx, next) => {
      await next();
    });
    requireAction(anyMw);
  });
});

describe('defineAction deny inference', () => {
  const authGuard = defineServerMiddleware('action', async () =>
    deny({ status: 401, message: 'auth', data: { loginUrl: '/login' } })
  );
  const quotaGuard = defineServerMiddleware('action', async () =>
    deny({ status: 429, message: 'quota', data: { retryAfterS: 60 } })
  );

  it('G1: unions the deny types across an inline use array', () => {
    const ref = defineAction(async (_ctx, _p: { title: string }) => 1, {
      use: [authGuard, quotaGuard],
    });
    expectTypeOf(ref.useAction().mutate).returns.resolves.toEqualTypeOf<
      MutateResult<number, { loginUrl: string } | { retryAfterS: number }>
    >();
  });

  it('G1b: a passthrough guard in the array does not widen the union', () => {
    const passthrough = defineServerMiddleware('action', async (_ctx, next) => {
      await next();
    });
    const ref = defineAction(async (_ctx, _p: { title: string }) => 1, {
      use: [authGuard, passthrough],
    });
    expectTypeOf(ref.useAction().mutate).returns.resolves.toEqualTypeOf<
      MutateResult<number, { loginUrl: string }>
    >();
  });

  it('G2: a pre-typed, erased use array is still accepted and degrades to unknown', () => {
    const existingUse: ReadonlyArray<ServerMiddleware<'action'>> = [authGuard];
    const ref = defineAction(async (_ctx, _p: { title: string }) => 1, {
      use: existingUse,
    });
    expectTypeOf(ref.useAction().mutate).returns.resolves.toEqualTypeOf<
      MutateResult<number, unknown>
    >();
  });

  it('G2b: an action with no `use` at all degrades to unknown, never `never`', () => {
    const ref = defineAction(async (_ctx, _p: { title: string }) => 1);
    expectTypeOf(ref.useAction().mutate).returns.resolves.toEqualTypeOf<
      MutateResult<number, unknown>
    >();
  });

  it('G3: the schema overload resolves with the const use parameter', () => {
    const schema = {} as StandardSchemaV1<unknown, { id: string }>;
    const ref = defineAction(async (_ctx, payload) => payload.id.length, {
      input: schema,
      use: [authGuard],
    });
    expectTypeOf(ref.useAction().mutate).returns.resolves.toEqualTypeOf<
      MutateResult<number, { loginUrl: string }>
    >();
  });

  it('G4: a stream observer in the use array drops out of the deny union', () => {
    const observer = {} as StreamObserver<string, number>;
    const ref = defineAction(
      async function* (_ctx, _p: { title: string }) {
        yield 'chunk';
        return 1;
      },
      { use: [authGuard, observer] }
    );
    expectTypeOf(ref.useAction().mutate).returns.resolves.toEqualTypeOf<
      MutateResult<number, { loginUrl: string }>
    >();
  });

  it('G4b: a guard that types its own deny data `any` demotes to unknown for the caller', () => {
    // The guard's author is not the party who pays: `any` here would land on
    // `deny.data` in the CALLER's MutateResult and switch off checking for
    // someone who never wrote it. It must arrive as `unknown`, still narrowable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sloppyGuard = defineServerMiddleware('action', async () =>
      deny({ status: 403, message: 'no', data: {} as any })
    );
    const ref = defineAction(async (_ctx, _p: { title: string }) => 1, {
      use: [sloppyGuard],
    });
    expectTypeOf(ref.useAction().mutate).returns.resolves.toEqualTypeOf<
      MutateResult<number, unknown>
    >();
  });

  it('G5: the narrow deny data is readable off the deny arm', async () => {
    const ref = defineAction(async (_ctx, _p: { title: string }) => 1, {
      use: [authGuard],
    });
    const outcome = await ref.useAction().mutate({ title: 'Dune' });
    if (!outcome.ok && outcome.kind === 'deny') {
      expectTypeOf(outcome.deny).toEqualTypeOf<
        DenyRecord<{ loginUrl: string }>
      >();
      expectTypeOf(outcome.deny.data).toEqualTypeOf<
        { loginUrl: string } | undefined
      >();
      // The framework's validation envelope has its own channel, so it can
      // never be read as the guard-derived deny data.
      expectTypeOf(outcome.deny.issues).toEqualTypeOf<
        ValidationIssue[] | undefined
      >();
    }
  });
});

describe('the deny record keeps validation issues off the typed data channel', () => {
  it('types `data` and `issues` as separate, independently optional fields', () => {
    // The defect this pins: a framework-issued schema failure denies with the
    // reserved issues bag. Routing it through `data` would type it as the
    // guard-derived TData, so `deny.data.loginUrl` would COMPILE and be
    // undefined at runtime. Two fields, two types, no overlap.
    expectTypeOf<DenyRecord<{ loginUrl: string }>['data']>().toEqualTypeOf<
      { loginUrl: string } | undefined
    >();
    expectTypeOf<DenyRecord<{ loginUrl: string }>['issues']>().toEqualTypeOf<
      ValidationIssue[] | undefined
    >();
  });

  it('does not widen `data` when TData is unknown', () => {
    expectTypeOf<DenyRecord['data']>().toEqualTypeOf<unknown>();
  });
});

describe('the consolidated deny record', () => {
  it('types useActionResult()s deny variant', () => {
    type Deny = Extract<
      ActionResult<{ title: string }, number>,
      { kind: 'deny' }
    >;
    expectTypeOf<Deny>().toMatchObjectType<DenyRecord>();
    expectTypeOf<Deny['submittedPayload']>().toEqualTypeOf<{ title: string }>();
  });

  it('discriminates the mutate success arm from the navigated arm by kind', () => {
    type Success = Extract<MutateResult<number>, { kind: 'success' }>;
    expectTypeOf<Success>().toEqualTypeOf<{
      data: number | undefined;
      ok: true;
      kind: 'success';
    }>();

    type Navigated = Extract<MutateResult<number>, { kind: 'navigated' }>;
    expectTypeOf<Navigated>().toEqualTypeOf<{ ok: true; kind: 'navigated' }>();
  });
});
