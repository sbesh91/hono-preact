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
// The general/union-scope slot: under the CORRECT indexed-access ServerCtx2<S>
// spelling, ServerMiddleware2<S> measures contravariant in S, so a
// general-scope function parameter of type ServerMiddleware2<Scope2, unknown>
// must reject a narrow ServerMiddleware2<'loader', X> argument (a single-scope
// middleware does not fit an all-scope slot). Under the BUGGY conditional
// spelling (`S extends 'page' ? ... : S extends 'loader' ? ... : ...`), both
// of TS's variance probes fall through to the same branch and the type
// measures bivariant, so the narrow middleware would WRONGLY be accepted here
// (negative control: not encoded, per the brief, since reproducing the bug
// alongside the fix in one file would just duplicate define-middleware.ts's
// own before/after, which is already documented there).
declare function requireAny<X>(m: ServerMiddleware2<Scope2, X>): void;

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
// G4: the real ActionUse union also admits StreamObserver for streaming
// actions (use-types.ts: `ReadonlyArray<ServerMiddleware<'action'> |
// StreamObserver<T, R>>`). Minimal stand-in mirroring its shape (the __kind
// discriminant is the load-bearing part: it is what lets DenyOf2 filter
// non-middleware elements out structurally).
type StreamObserver2<TChunk = unknown, TResult = void> = {
  __kind: 'observer';
  onChunk?: (chunk: TChunk) => void;
  onEnd?: (info: { result: TResult }) => void;
};

type AnyMw2 = ServerMiddleware2<'action', any>;
type UseElement2 = AnyMw2 | StreamObserver2<any, any>;
// Widened to admit StreamObserver2 alongside the middleware arm. `U[number]`
// is an INDEXED ACCESS, not a naked type-parameter reference, so `U[number]
// extends ServerMiddleware2<string, infer D> ? D : never` does NOT distribute
// per-element the way A-G3's single-shape `DenyOf` did: it tests the WHOLE
// union `AnyMw2 | StreamObserver2` against the middleware shape in one shot,
// which fails (StreamObserver2 does not match), so the entire type collapses
// to `never` regardless of what the guard elements are. Attempt 1 (kept
// `U[number]`) reproduced exactly this failure across G1-G4. Attempt 2:
// distribute element-wise over the TUPLE via a mapped type keyed on `keyof U`
// (each `U[K]` access IS effectively a naked per-position lookup TS
// distributes over), then flatten with a trailing `[number]` index into the
// resulting tuple-of-results. That alone still failed every G assertion with
// "Actual never", for two stacked reasons, both confirmed in isolation with a
// throwaway `tsc` probe outside this file:
//   (a) the branch read `ServerMiddleware2<string, infer D>`, but
//       `ServerMiddleware2`'s first parameter is constrained `S extends
//       Scope2`, and `string` does not satisfy `Scope2` (`tsc` reports TS2344
//       on that branch in isolation), so the conditional never matched
//       anything, even a real middleware element;
//   (b) swapping in `ServerMiddleware2<Scope2, infer D>` (Attempt 3) fixed
//       the constraint error but STILL produced `never` for real elements,
//       because `fn` is a property holding a function type: under
//       `--strict`, matching `A0 extends ServerMiddleware2<Scope2, infer D>`
//       requires A0's `fn` (parameter `ctx: ServerCtx2<'action'>`, one
//       specific ctx) to be assignable to the pattern's `fn` (parameter
//       `ctx: ServerCtx2<Scope2>`, the union of all three ctx shapes) at a
//       CONTRAVARIANT parameter position — a single-scope middleware's fn can
//       never accept the whole ctx union, so the extends check fails
//       structurally and falls to `never` before `D` is ever unified.
// Attempt 4: pin the probed scope to `any` instead of `Scope2`.
// `ServerCtx2<any>` collapses to `any`, so the ctx parameter comparison stops
// gating the match (an `any` parameter is assignable both ways), and `D`
// unifies from the TDeny position as intended. This `any` is in a type
// PATTERN position inside a conditional-type match (the same category as the
// constraint-position `any` on `AnyMw2` below), never a value-position cast.
// That fixed G1-G4a but left G4b (a pre-typed, non-literal
// `ReadonlyArray<ServerMiddleware2<'action'> | StreamObserver2>` variable)
// producing `never` instead of `unknown`: for a genuine array type (not a
// `const`-inferred literal tuple), `keyof U` is an index signature, not
// per-position literal keys, so `U[K]` is the array's WHOLE element union
// (`ServerMiddleware2<'action'> | StreamObserver2`) at every `K`, and that
// indexed access is not a naked type-parameter reference, so the conditional
// still does not distribute: it tests the union against the pattern in one
// shot and fails, falling to `never`. Attempt 5: wrap the per-element check
// in its own single-parameter alias, `DenyOfElement<X>`. Instantiating
// `DenyOfElement<U[K]>` passes a FRESH type argument `X`, and `X extends ...`
// inside that alias's own body IS a naked reference, so it distributes over
// `U[K]`'s union: the `ServerMiddleware2<'action'>` member unifies `D` as its
// (defaulted) `unknown` TDeny, the `StreamObserver2` member falls to `never`,
// and the two branches union back to `unknown | never = unknown`, which is
// exactly the "degrades safely, does not error" outcome G4b asserts. This
// also still gives G4a its narrow per-position result, since for a real
// literal tuple each `U[K]` is already a single non-union member.
type DenyOfElement<X> = X extends ServerMiddleware2<any, infer D> ? D : never;
type DenyOf2<U extends readonly UseElement2[]> = {
  [K in keyof U]: DenyOfElement<U[K]>;
}[number];

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
  const U extends ReadonlyArray<UseElement2> = readonly [],
>(opts: { use?: U; fn: () => TResult }): { __deny: DenyOf2<U>; __result: TResult };

// Schema-overload sketch (G3): a `schema`-carrying overload and a plain
// overload, each independently generic over the same `const U` shape, mirror
// action.ts's two public overloads plus its untyped implementation signature.
declare function defineAction2Schema<
  TInput,
  TResult,
  const U extends ReadonlyArray<UseElement2> = readonly [],
>(opts: {
  input: TInput;
  use?: U;
  fn: (input: TInput) => TResult;
}): { __deny: DenyOf2<U>; __result: TResult };
declare function defineAction2Schema<
  TResult,
  const U extends ReadonlyArray<UseElement2> = readonly [],
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

  it("F1': the real #359/#362 variance property survives the added TDeny param", () => {
    let loaderMw!: ServerMiddleware2<'loader', { reason: string }>;
    // This is the actual hazard the bivariance fix closed: under the buggy
    // conditional-in-check-position ServerCtx spelling, BOTH of TS's variance
    // probes fall through to the same branch, ServerMiddleware<S> measures
    // BIVARIANT in S, and a narrow ServerMiddleware<'loader'> would WRONGLY be
    // assignable to a general/union-scope slot ServerMiddleware<Scope> (every
    // scope tag becomes interchangeable with Scope). Under the correct
    // indexed-access spelling used here, ServerCtx2<S> is contravariant in S,
    // so the general slot must reject the narrow middleware.
    // @ts-expect-error a single-scope ServerMiddleware2<'loader', X> must not
    // satisfy an all-scope ServerMiddleware2<Scope2, X> slot; the dispatcher
    // may hand this slot a page or action ctx that a loader-only fn never
    // declared it could handle.
    requireAny(loaderMw);
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

  it('G4a: DenyOf2 extracts the guard deny type from a mixed middleware/observer array', () => {
    const authGuard = defineMiddleware2('action', async () =>
      deny({ status: 401, message: 'auth', data: { loginUrl: '/login' } })
    );
    let observer!: StreamObserver2<string, number>;
    const ref = defineAction2({ use: [authGuard, observer], fn: () => 1 });
    // The StreamObserver2 element drops out of the union (no `scope`
    // property to match ServerMiddleware2<string, infer D>), so only the
    // guard's deny type survives, not `{ loginUrl: string } | never`
    // collapsing to something wider.
    expectTypeOf(ref.__deny).toEqualTypeOf<{ loginUrl: string }>();
  });

  it('G4b: a pre-typed heterogeneous use array is still accepted, degrading to unknown', () => {
    let existingUse!: ReadonlyArray<
      ServerMiddleware2<'action'> | StreamObserver2
    >;
    const ref = defineAction2({ use: existingUse, fn: () => 1 });
    expectTypeOf(ref.__deny).toEqualTypeOf<unknown>();
  });
});
