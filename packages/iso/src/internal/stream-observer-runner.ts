import type {
  StreamObserver,
  ServerStreamCtx,
} from '../define-stream-observer.js';

function safeCall(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch (err) {
    // Observer errors are isolated: surface via console for visibility but do
    // not propagate. The stream is the source of truth; observers are a side
    // channel and cannot corrupt the channel they observe.
    // eslint-disable-next-line no-console
    console.error('[stream-observer] hook threw and was isolated:', err);
  }
}

export function fanStart(
  observers: ReadonlyArray<StreamObserver<unknown, never>>,
  ctx: ServerStreamCtx
): void {
  for (const o of observers) {
    safeCall(o.onStart ? () => o.onStart!(ctx) : undefined);
  }
}

export function fanChunk(
  observers: ReadonlyArray<StreamObserver<unknown, never>>,
  ctx: ServerStreamCtx,
  chunk: unknown,
  index: number
): void {
  for (const o of observers) {
    safeCall(o.onChunk ? () => o.onChunk!(ctx, chunk, index) : undefined);
  }
}

export function fanEnd(
  observers: ReadonlyArray<StreamObserver<unknown, never>>,
  ctx: ServerStreamCtx,
  info: { chunks: number; result: unknown }
): void {
  for (const o of observers) {
    safeCall(
      o.onEnd
        ? () =>
            // The partitioner widens observers to TResult=never (the only
            // shape that admits arbitrary user-declared TResult); the call
            // site provides whatever the underlying stream produced. The
            // cast bridges the invariance gap and is safe because TS
            // can't reason about the contravariant function-parameter
            // shape across the array boundary.
            (
              o.onEnd as (
                ctx: ServerStreamCtx,
                info: { chunks: number; result: unknown }
              ) => void
            )(ctx, info)
        : undefined
    );
  }
}

export function fanError(
  observers: ReadonlyArray<StreamObserver<unknown, never>>,
  ctx: ServerStreamCtx,
  err: unknown,
  info: { chunks: number }
): void {
  for (const o of observers) {
    safeCall(o.onError ? () => o.onError!(ctx, err, info) : undefined);
  }
}

export function fanAbort(
  observers: ReadonlyArray<StreamObserver<unknown, never>>,
  ctx: ServerStreamCtx,
  info: { chunks: number }
): void {
  for (const o of observers) {
    safeCall(o.onAbort ? () => o.onAbort!(ctx, info) : undefined);
  }
}
