import type { DenyCode } from './outcomes.js';

/**
 * Thrown by the client loader RPC path when a guard or a loader denies the
 * request. It carries the structured deny envelope -- HTTP `status`, the
 * optional {@link DenyCode}, and the optional `data` payload -- so an
 * `errorFallback` can `switch` on `code` instead of parsing the message
 * string, which is the parity the action path has had since the code
 * vocabulary landed.
 *
 * A deny whose `data` carries the reserved validation-issues key raises the
 * more specific `LoaderValidationError` instead, so a schema failure keeps
 * reaching `getValidationIssues()`.
 */
export class LoaderDenyError extends Error {
  readonly status: number;
  readonly code?: DenyCode;
  readonly data?: unknown;
  constructor(
    status: number,
    message: string,
    opts: { code?: DenyCode; data?: unknown } = {}
  ) {
    super(message);
    this.name = 'LoaderDenyError';
    this.status = status;
    this.code = opts.code;
    this.data = opts.data;
  }
}
