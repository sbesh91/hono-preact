// src/iso/guard.ts
import { type FunctionComponent } from 'preact';
import type { Context } from 'hono';
import { type RouteHook } from 'preact-iso';

export type GuardRunsOn = 'server' | 'client';

export type GuardResult =
  | { redirect: string }
  | { render: FunctionComponent }
  | void;

export type ServerGuardContext = {
  c: Context;
  location: RouteHook;
};

export type ClientGuardContext = {
  location: RouteHook;
};

export type ServerGuardFn = {
  readonly runs: 'server';
  readonly fn: (
    ctx: ServerGuardContext,
    next: () => Promise<GuardResult>
  ) => GuardResult | Promise<GuardResult>;
};

export type ClientGuardFn = {
  readonly runs: 'client';
  readonly fn: (
    ctx: ClientGuardContext,
    next: () => Promise<GuardResult>
  ) => GuardResult | Promise<GuardResult>;
};

export type GuardFn = ServerGuardFn | ClientGuardFn;

export const defineServerGuard = (fn: ServerGuardFn['fn']): ServerGuardFn => ({
  runs: 'server',
  fn,
});

export const defineClientGuard = (fn: ClientGuardFn['fn']): ClientGuardFn => ({
  runs: 'client',
  fn,
});

export const runServerGuards = async (
  guards: ServerGuardFn[],
  ctx: ServerGuardContext
): Promise<GuardResult> => {
  const run = async (index: number): Promise<GuardResult> => {
    if (index >= guards.length) return;
    return guards[index].fn(ctx, () => run(index + 1));
  };
  return run(0);
};

export const runClientGuards = async (
  guards: ClientGuardFn[],
  ctx: ClientGuardContext
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
