import type {
  ServerLoaderCtx,
  ServerActionCtx,
} from './define-middleware.js';

export type ServerStreamCtx = ServerLoaderCtx | ServerActionCtx;

export type StreamObserver<TChunk = unknown, TResult = void> = {
  __kind: 'observer';
  onStart?: (ctx: ServerStreamCtx) => void;
  onChunk?: (ctx: ServerStreamCtx, chunk: TChunk, index: number) => void;
  onEnd?: (
    ctx: ServerStreamCtx,
    info: { chunks: number; result: TResult }
  ) => void;
  onError?: (
    ctx: ServerStreamCtx,
    err: unknown,
    info: { chunks: number }
  ) => void;
  onAbort?: (ctx: ServerStreamCtx, info: { chunks: number }) => void;
};

type Spec<TChunk, TResult> = Omit<StreamObserver<TChunk, TResult>, '__kind'>;

export function defineStreamObserver<TChunk = unknown, TResult = void>(
  spec: Spec<TChunk, TResult>
): StreamObserver<TChunk, TResult> {
  return { __kind: 'observer', ...spec };
}
