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
});
