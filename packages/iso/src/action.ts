export type ActionStub<TPayload, TResult> = {
  readonly __module: string;
  readonly __action: string;
  readonly __phantom?: readonly [TPayload, TResult];
};

export function defineAction<TPayload, TResult>(
  fn: (ctx: unknown, payload: TPayload) => Promise<TResult>
): ActionStub<TPayload, TResult> {
  // Runtime no-op: returns fn as-is. actionsHandler casts it back to a function.
  // The ActionStub type is enforced only by TypeScript and the Vite plugin.
  return fn as unknown as ActionStub<TPayload, TResult>;
}
