import { describe, it, expectTypeOf } from 'vitest';

// Local stand-ins mirroring the REAL shapes (outcomes.ts, define-middleware.ts,
// action.ts) closely enough that success here predicts success there.
type DenyCode = 'unauthorized' | 'forbidden';
type DenyOutcome<TData = unknown> = {
  __outcome: 'deny';
  status: number;
  message: string;
  data?: TData;
  code?: DenyCode;
};
type RedirectOutcome = { __outcome: 'redirect'; to: string };
type Outcome = DenyOutcome | RedirectOutcome;

declare function deny<TData>(opts: {
  status: number;
  message: string;
  data: TData;
}): DenyOutcome<TData>;
declare function deny(opts: {
  status: number;
  message: string;
}): DenyOutcome<never>;

type MwFn<TDeny> = (
  ctx: unknown,
  next: () => Promise<void>
) => Promise<void | Exclude<Outcome, DenyOutcome> | DenyOutcome<TDeny>>;
type ServerMiddleware<S extends string, TDeny = unknown> = {
  scope: S;
  fn: MwFn<TDeny>;
};
declare function defineMiddleware<TDeny = never>(
  fn: MwFn<TDeny>
): ServerMiddleware<'action', TDeny>;

type AnyMw = ServerMiddleware<string, unknown>;
type DenyOf<U extends readonly AnyMw[]> =
  U[number] extends ServerMiddleware<string, infer D> ? D : never;
declare function defineAction<TResult, const U extends readonly AnyMw[]>(opts: {
  use: U;
  fn: () => TResult;
}): { __deny: DenyOf<U>; __result: TResult };

// --- F: dual-generic ServerMiddleware with the REAL scope mechanism ---
// Copied structurally from packages/iso/src/define-middleware.ts: `ServerCtx<S>`
// is an indexed access over a scope-keyed object type, not a chain of `S
// extends ... ? ... : ...` conditionals, because the indexed-access spelling
// is what makes `ServerMiddleware2<S>` measure CONTRAVARIANT in `S` (the
// #359/#362 bivariance fix). A conditional-in-check-position spelling would
// make every scope tag interchangeable, which is exactly the bug that fix
// closed, so the spike must reproduce the indexed access, not simplify it
// away.
type Scope2 = 'page' | 'loader' | 'action';
type ServerPageCtx2 = { scope: 'page'; page: true };
type ServerLoaderCtx2 = { scope: 'loader'; loader: true };
type ServerActionCtx2 = { scope: 'action'; action: true };
type ServerCtx2<S extends Scope2 = Scope2> = {
  page: ServerPageCtx2;
  loader: ServerLoaderCtx2;
  action: ServerActionCtx2;
}[S];

type MwFn2<S extends Scope2, TDeny> = (
  ctx: ServerCtx2<S>,
  next: () => Promise<void>
) => Promise<void | Exclude<Outcome, DenyOutcome> | DenyOutcome<TDeny>>;
type ServerMiddleware2<S extends Scope2 = Scope2, TDeny = unknown> = {
  scope: S;
  fn: MwFn2<S, TDeny>;
};
declare function defineMiddleware2<S extends Scope2, TDeny = never>(
  scope: S,
  fn: MwFn2<S, TDeny>
): ServerMiddleware2<S, TDeny>;
declare function requireAction<X>(m: ServerMiddleware2<'action', X>): void;

// --- G: const-tuple ActionUse modeled on the REAL
// packages/iso/src/internal/use-types.ts / action.ts shapes ---
// The real `ActionUse<TChunk, TResult, Streaming>` is
// `ReadonlyArray<ServerMiddleware<'action'> | ...>`: a homogeneous readonly
// array type, which erases each element's own generic argument (every element
// widens to the declared array element type before any per-element inference
// can run). Task 6's redesign for path A needs `use` typed so a `const`-tuple
// type parameter on `defineAction` itself captures the literal tuple (and
// therefore each element's own `TDeny`) BEFORE it is asked to conform to the
// erasing array shape, while an existing call site that already has a
// pre-typed `ReadonlyArray<ServerMiddleware<'action'>>` variable (TDeny
// collapsed to `unknown` per-element) must still be accepted, just without
// the narrow per-element union.
type AnyMw2 = ServerMiddleware2<'action', any>;
type DenyOf2<U extends readonly AnyMw2[]> =
  U[number] extends ServerMiddleware2<'action', infer D> ? D : never;

// `any` appears only in the CONSTRAINT position (`ReadonlyArray<ServerMiddleware2<'action', any>>`),
// never as a value-position cast. It is required here because the constraint
// has to admit BOTH a literal tuple of narrowly-typed elements (`{loginUrl:
// string}`, `{retryAfterS: number}`, ...) and the pre-typed, TDeny-erased
// `ServerMiddleware2<'action'>` (TDeny defaults to `unknown`) array from G2.
// `unknown` in the constraint would reject the narrow literal-tuple elements
// (a `ServerMiddleware2<'action', {loginUrl:string}>` is not assignable to
// `ServerMiddleware2<'action', unknown>`'s covariant read of TDeny through a
// bare structural check the same way `any` accepts it bidirectionally); `any`
// is the deliberate escape hatch TS itself uses for "any TDeny is fine at the
// constraint boundary, let inference decide what U actually is."
declare function defineAction2<
  TResult,
  const U extends ReadonlyArray<AnyMw2> = readonly [],
>(opts: { use?: U; fn: () => TResult }): { __deny: DenyOf2<U>; __result: TResult };

// Schema-overload sketch (G3): a `schema`-carrying overload and a plain
// overload, each independently generic over the same `const U` shape, mirror
// action.ts's two public overloads plus its untyped implementation signature.
declare function defineAction2Schema<
  TInput,
  TResult,
  const U extends ReadonlyArray<AnyMw2> = readonly [],
>(opts: {
  input: TInput;
  use?: U;
  fn: (input: TInput) => TResult;
}): { __deny: DenyOf2<U>; __result: TResult };
declare function defineAction2Schema<
  TResult,
  const U extends ReadonlyArray<AnyMw2> = readonly [],
>(opts: { use?: U; fn: () => TResult }): { __deny: DenyOf2<U>; __result: TResult };

describe('TDenyData inference spike', () => {
  it('A: deny() infers TData from the data argument', () => {
    const d = deny({ status: 403, message: 'no', data: { reason: 'quota' } });
    expectTypeOf(d).toEqualTypeOf<DenyOutcome<{ reason: string }>>();
  });

  it('B: defineMiddleware captures the deny type from the fn body', () => {
    const guard = defineMiddleware(async (_ctx, next) => {
      if (Math.random() > 1) {
        return deny({ status: 403, message: 'no', data: { reason: 'q' } });
      }
      await next();
    });
    expectTypeOf(guard).toEqualTypeOf<
      ServerMiddleware<'action', { reason: string }>
    >();
  });

  it('C: a redirect-returning middleware does not poison the deny type', () => {
    const passthrough = defineMiddleware(async (_ctx, next) => {
      await next();
    });
    // No deny in the body: TDeny should collapse to never, not unknown.
    expectTypeOf(passthrough).toEqualTypeOf<
      ServerMiddleware<'action', never>
    >();
  });

  it('D: defineAction unions deny types across the use array', () => {
    const authGuard = defineMiddleware(async () =>
      deny({ status: 401, message: 'auth', data: { loginUrl: '/login' } })
    );
    const quotaGuard = defineMiddleware(async () =>
      deny({ status: 429, message: 'quota', data: { retryAfterS: 60 } })
    );
    const ref = defineAction({ use: [authGuard, quotaGuard], fn: () => 1 });
    expectTypeOf(ref.__deny).toEqualTypeOf<
      { loginUrl: string } | { retryAfterS: number }
    >();
  });

  it('E: a default-unknown middleware in the array degrades the union to unknown, not never', () => {
    let legacy!: ServerMiddleware<'action'>; // TDeny = unknown
    const authGuard = defineMiddleware(async () =>
      deny({ status: 401, message: 'auth', data: { loginUrl: '/login' } })
    );
    const ref = defineAction({ use: [authGuard, legacy], fn: () => 1 });
    // unknown must absorb: callers cannot trust the narrow union.
    expectTypeOf(ref.__deny).toEqualTypeOf<unknown>();
  });

  it('F1: scope strictness survives the added TDeny param', () => {
    let loaderMw!: ServerMiddleware2<'loader', { reason: string }>;
    // @ts-expect-error a loader-scoped middleware must not satisfy an
    // action-scoped slot, even though both carry the same TDeny; the scope
    // tag (and the ctx it drives through the indexed-access ServerCtx2<S>)
    // still gates assignability with TDeny in play.
    requireAction(loaderMw);
  });

  it('F2: TDeny still infers through defineMiddleware2 with real indexed-access ctx typing', () => {
    const actionGuard = defineMiddleware2('action', async (ctx, next) => {
      // ctx narrows to ServerActionCtx2 via the indexed access, not a union.
      expectTypeOf(ctx).toEqualTypeOf<ServerActionCtx2>();
      if (Math.random() > 1) {
        return deny({ status: 403, message: 'no', data: { reason: 'q' } });
      }
      await next();
    });
    expectTypeOf(actionGuard).toEqualTypeOf<
      ServerMiddleware2<'action', { reason: string }>
    >();
  });

  it('G1: DenyOf extracts the union from an inline array literal', () => {
    const authGuard = defineMiddleware2('action', async () =>
      deny({ status: 401, message: 'auth', data: { loginUrl: '/login' } })
    );
    const quotaGuard = defineMiddleware2('action', async () =>
      deny({ status: 429, message: 'quota', data: { retryAfterS: 60 } })
    );
    const ref = defineAction2({
      use: [authGuard, quotaGuard],
      fn: () => 1,
    });
    expectTypeOf(ref.__deny).toEqualTypeOf<
      { loginUrl: string } | { retryAfterS: number }
    >();
  });

  it('G2: a pre-typed, TDeny-erased use array is still accepted and degrades to unknown', () => {
    // The back-compat case: an existing call site holds `use` in a variable
    // typed against the collapsed array shape (what ActionUse<...> produces
    // today), not a fresh literal tuple. TDeny already defaulted to `unknown`
    // per element before this variable's type was written down.
    let existingUse!: ReadonlyArray<ServerMiddleware2<'action'>>;
    const ref = defineAction2({ use: existingUse, fn: () => 1 });
    expectTypeOf(ref.__deny).toEqualTypeOf<unknown>();
  });

  it('G3: schema and plain overloads both resolve with the const U param', () => {
    const authGuard = defineMiddleware2('action', async () =>
      deny({ status: 401, message: 'auth', data: { loginUrl: '/login' } })
    );
    const withSchema = defineAction2Schema({
      input: {} as { id: string },
      use: [authGuard],
      fn: (input) => input.id.length,
    });
    expectTypeOf(withSchema.__deny).toEqualTypeOf<{ loginUrl: string }>();
    expectTypeOf(withSchema.__result).toEqualTypeOf<number>();

    const plain = defineAction2Schema({
      use: [authGuard],
      fn: () => 'ok',
    });
    expectTypeOf(plain.__deny).toEqualTypeOf<{ loginUrl: string }>();
    expectTypeOf(plain.__result).toEqualTypeOf<string>();
  });
});
