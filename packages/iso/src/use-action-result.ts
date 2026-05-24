import { useContext } from 'preact/hooks';
import { ActionResultContext } from './action-result-context.js';
import type { ActionStub } from './action.js';

export type ActionResult<TPayload, TResult> =
  | { kind: 'success'; data: TResult; submittedPayload: TPayload }
  | {
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
      submittedPayload: TPayload;
    }
  | {
      kind: 'error';
      message: string;
      submittedPayload: TPayload | null;
    }
  | null;

export function useActionResult<TPayload = unknown, TResult = unknown>(
  stub?: ActionStub<TPayload, TResult, never>
): ActionResult<TPayload, TResult> {
  const ctx = useContext(ActionResultContext);
  if (!ctx) return null;
  if (stub && (ctx.module !== stub.__module || ctx.action !== stub.__action)) {
    return null;
  }
  if (ctx.kind === 'success') {
    return {
      kind: 'success',
      data: ctx.data as TResult,
      submittedPayload: ctx.submittedPayload as TPayload,
    };
  }
  if (ctx.kind === 'deny') {
    return {
      kind: 'deny',
      status: ctx.status,
      message: ctx.message,
      data: ctx.data,
      submittedPayload: ctx.submittedPayload as TPayload,
    };
  }
  return {
    kind: 'error',
    message: ctx.message,
    submittedPayload: ctx.submittedPayload as TPayload | null,
  };
}
