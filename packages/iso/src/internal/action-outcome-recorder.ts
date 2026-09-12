import { setLastActionResult } from './action-result-store.js';
import type { DenyCode } from '../outcomes.js';

/**
 * A deny as the recorder receives it, before it is stored.
 *
 * `code` is optional-and-omittable rather than `DenyCode | undefined`: the
 * stored record must not carry an explicit `code: undefined` key, since
 * `useActionResult()` consumers distinguish an absent code from a present one.
 */
export interface RecordableDeny {
  status: number;
  message: string;
  data?: unknown;
  code?: DenyCode;
}

/**
 * Records the terminal outcome of one `mutate()` call into the action-result
 * store, and remembers whether it has done so.
 *
 * A single mutation can end in seven places (stream error, stream success,
 * JSON success, deny, error, timeout, and the outer catch's unclassified
 * failure). Every one of them needs the same three constants -- module,
 * action, and the submitted payload -- and every one of them also has to mark
 * that the store has been written, because the outer catch must record only
 * when no branch already did.
 *
 * Inlined, that is a hand-maintained flag and a repeated triple at each of the
 * seven sites: a branch that forgets to set the flag silently gets its outcome
 * overwritten by the catch, and a branch that forgets `submittedPayload`
 * silently drops the payload from `useActionResult()`. Binding the constants
 * once and folding the flag into the recorder makes both mistakes
 * unrepresentable rather than merely unlikely.
 */
export interface ActionOutcomeRecorder {
  /** True once any of the methods below has written to the store. */
  readonly recorded: boolean;
  success(data: unknown): void;
  error(message: string): void;
  deny(deny: RecordableDeny): void;
  /**
   * Record an error outcome, but only if no branch has already recorded one.
   *
   * This is the outer catch's rule: an unclassified failure (a network error,
   * a parse error) must be stored, while a failure a branch already classified
   * must keep the richer record that branch wrote. Expressed here rather than
   * as an `if (!recorded)` at the call site so the two halves of the rule
   * cannot drift apart.
   */
  fallbackError(message: string): void;
}

export function createActionOutcomeRecorder(
  module: string,
  action: string,
  submittedPayload: unknown
): ActionOutcomeRecorder {
  let recorded = false;

  const error = (message: string): void => {
    setLastActionResult(module, action, {
      kind: 'error',
      message,
      submittedPayload,
    });
    recorded = true;
  };

  return {
    get recorded() {
      return recorded;
    },
    success(data) {
      setLastActionResult(module, action, {
        kind: 'success',
        data,
        submittedPayload,
      });
      recorded = true;
    },
    error,
    deny(deny) {
      setLastActionResult(module, action, {
        kind: 'deny',
        status: deny.status,
        message: deny.message,
        data: deny.data,
        // Spread-when-present, never `code: undefined`: consumers read the
        // key's presence.
        ...(deny.code !== undefined ? { code: deny.code } : {}),
        submittedPayload,
      });
      recorded = true;
    },
    fallbackError(message) {
      if (recorded) return;
      error(message);
    },
  };
}
