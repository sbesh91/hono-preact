import { useComputed, useSignal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';

/**
 * How a reader hook should match store entries for the action it was given.
 *
 * The two flags are NOT redundant. `defineAction` attaches `__module` and
 * `__action` only when the Vite `moduleKeyPlugin` injected them (`action.ts`
 * guards both with `!== undefined`), so a stub from a module the plugin never
 * processed carries neither. That makes three states, where a naive
 * `ref !== undefined` test sees only two:
 *
 * | caller passed        | `ref`       | means                                |
 * |----------------------|-------------|--------------------------------------|
 * | nothing              | `undefined` | any action: "the last result here"   |
 * | a keyed stub         | the key     | exactly that action                  |
 * | an un-rewritten stub | `undefined` | NOTHING: an action was named, but we |
 * |                      |             | cannot tell which one                |
 *
 * Collapsing the third into the first is a cross-action leak: the reader adopts
 * whatever unrelated action wrote last (review round 3, T1).
 */
export type StubKey = {
  /** The identity to match on, or `undefined` when there is nothing to match. */
  readonly ref: { __module: string; __action: string } | undefined;
  /**
   * The caller named an action, but it carries no identity, so no entry can
   * honestly be attributed to it. A reader seeing this must report its EMPTY
   * value rather than falling back to the any-action branch.
   */
  readonly unmatchable: boolean;
};

/**
 * Mirror a stub's identity into tracked signals and derive how to match on it.
 *
 * The mirroring is what makes a reader follow a stub that CHANGES. Both callers
 * project through a `useComputed`, which is `useMemo(..., [])`: created once and
 * re-evaluated only when a tracked signal moves. A plain closure capture of
 * `stub` would pin the reader to whichever action was passed on the mount
 * render, so a `<Form action={mode === 'create' ? createTodo : updateTodo}>`
 * that flips `mode` would keep reporting the previous action's state. The
 * mirrored values are two primitive strings and a boolean, so a fresh stub
 * object literal per render is a no-op write.
 */
export function useStubKey(
  stub: { __module?: string; __action?: string } | undefined
): ReadonlySignal<StubKey> {
  const module = useSignal<string | undefined>(stub?.__module);
  const action = useSignal<string | undefined>(stub?.__action);
  const given = useSignal<boolean>(stub !== undefined);
  module.value = stub?.__module;
  action.value = stub?.__action;
  given.value = stub !== undefined;

  return useComputed(() => {
    const m = module.value;
    const a = action.value;
    const ref =
      m !== undefined && a !== undefined
        ? { __module: m, __action: a }
        : undefined;
    return { ref, unmatchable: given.value && ref === undefined };
  });
}
