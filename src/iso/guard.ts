// src/iso/guard.ts
import { type FunctionComponent } from 'preact';
import { type RouteHook } from 'preact-iso';

export type GuardResult =
  | { redirect: string }
  | { render: FunctionComponent }
  | void;

export type GuardContext = {
  location: RouteHook;
};

/** Must `return next()` (not just `await next()`) to propagate downstream results. */
export type GuardFn = (
  ctx: GuardContext,
  next: () => Promise<GuardResult>
) => Promise<GuardResult>;

export const createGuard = (fn: GuardFn): GuardFn => fn;

export const runGuards = async (
  guards: GuardFn[],
  ctx: GuardContext
): Promise<GuardResult> => {
  const run = async (index: number): Promise<GuardResult> => {
    if (index >= guards.length) return;
    return guards[index](ctx, () => run(index + 1));
  };
  return run(0);
};

export class GuardRedirect extends Error {
  constructor(public readonly location: string) {
    super(`Guard redirect to ${location}`);
    this.name = 'GuardRedirect';
  }
}
