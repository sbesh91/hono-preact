import type { DenyCode } from '../outcomes.js';

/**
 * The one shape a denied request takes on the client, whichever channel it
 * arrives through: `mutate`'s deny arm, `useActionResult()`'s deny variant,
 * the client action-result store, and the SSR action-result context all
 * describe it with this record rather than re-spelling four near-identical
 * inline object types that could drift a field apart.
 *
 * `status` is authoritative; `code` is the optional typed decoration a caller
 * can `switch` on. `data` is whatever the guard attached: `TData` is the
 * action's declared deny-data type where one is inferred, and `unknown`
 * everywhere the channel is type-erased (the stores carry every action's
 * results through one keyed map, so they cannot know a reader's type).
 *
 * Note the one shape `TData` does not describe: a framework-issued schema
 * failure denies with the reserved validation-issues envelope in `data`.
 * Read those with `getValidationIssues()`, which takes `unknown` precisely so
 * it works regardless of the declared type.
 */
export type DenyRecord<TData = unknown> = {
  status: number;
  message: string;
  code?: DenyCode;
  data?: TData;
};
