import { defineStreamObserver, type ServerStreamCtx } from 'hono-preact';
import { recordAudit } from './audit-log.js';

// Pure formatter, exported for the unit test (a real ServerStreamCtx cannot
// be stubbed structurally: Hono's Context has private fields).
export function streamAuditLine(
  phase: 'start' | 'end' | 'error' | 'abort',
  unit: string,
  chunks?: number
): string {
  const suffix = chunks === undefined ? '' : ` (${chunks} chunks)`;
  return `stream ${phase} ${unit}${suffix}`;
}

function unitName(ctx: ServerStreamCtx): string {
  return ctx.scope === 'loader'
    ? `${ctx.module}.${ctx.loader}`
    : `${ctx.module}.${ctx.action}`;
}

// App-level stream observer (AppConfig.use): sees every streaming loader
// and action in the app. The Vite guard-strip plugin replaces this call
// with a bare descriptor in the client bundle, so none of this ships to
// the browser.
export const streamAudit = defineStreamObserver<unknown, never>({
  onStart: (ctx) => recordAudit(streamAuditLine('start', unitName(ctx))),
  onEnd: (ctx, info) =>
    recordAudit(streamAuditLine('end', unitName(ctx), info.chunks)),
  onError: (ctx, _err, info) =>
    recordAudit(streamAuditLine('error', unitName(ctx), info.chunks)),
  onAbort: (ctx, info) =>
    recordAudit(streamAuditLine('abort', unitName(ctx), info.chunks)),
});
