import type { DenyCode } from '../outcomes.js';
import type { ValidationIssue } from './validation-issues.js';

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
 * `data` and `issues` are two channels, never one. A framework-issued schema
 * failure denies with the reserved validation-issues envelope, which is not
 * the action's declared deny type: routing it into `data` would type it as
 * `TData` and let `deny.data.someGuardField` compile and be `undefined` at
 * runtime. So a validation deny populates `issues` and leaves `data` unset,
 * and a guard deny does the reverse. The split is enforced where the envelope
 * is decoded, not by convention.
 */
export type DenyRecord<TData = unknown> = {
  status: number;
  message: string;
  code?: DenyCode;
  /** Whatever a guard attached. Absent on a framework validation deny. */
  data?: TData;
  /**
   * The normalized field issues of a schema failure. Absent on a guard deny.
   * The same shape `getValidationIssues()` returns.
   */
  issues?: ValidationIssue[];
};
