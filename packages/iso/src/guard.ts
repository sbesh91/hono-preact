// src/iso/guard.ts
import { type FunctionComponent } from 'preact';
import { type RouteHook } from 'preact-iso';

export type GuardRunsOn = 'server' | 'client';

export type GuardResult =
  | { redirect: string }
  | { render: FunctionComponent }
  | void;

export type GuardContext = {
  location: RouteHook;
};

export type GuardFn = {
  readonly runs: GuardRunsOn;
  readonly fn: (
    ctx: GuardContext,
    next: () => Promise<GuardResult>,
  ) => Promise<GuardResult>;
};

export const defineServerGuard = (fn: GuardFn['fn']): GuardFn => ({
  runs: 'server',
  fn,
});

export const defineClientGuard = (fn: GuardFn['fn']): GuardFn => ({
  runs: 'client',
  fn,
});

export const runGuards = async (
  guards: GuardFn[],
  ctx: GuardContext,
): Promise<GuardResult> => {
  const run = async (index: number): Promise<GuardResult> => {
    if (index >= guards.length) return;
    return guards[index].fn(ctx, () => run(index + 1));
  };
  return run(0);
};

export class GuardRedirect extends Error {
  constructor(public readonly location: string) {
    super(`Guard redirect to ${location}`);
    this.name = 'GuardRedirect';
  }
}
