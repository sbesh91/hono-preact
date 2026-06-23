// Ambient declaration of the single `node:async_hooks` export the CF pub/sub
// backend uses (AsyncLocalStorage). This is a NON-module .d.ts (no top-level
// import/export), so `declare module` is a clean ambient module declaration, not
// an augmentation. It exists so cf-pubsub.ts can `import { AsyncLocalStorage }
// from 'node:async_hooks'` WITHOUT adding global @types/node to the server
// build, which would clash with the DOM/@cloudflare/workers-types globals
// (WebSocket, MessageEvent) the cf files rely on. The runtime is provided by
// nodejs_compat on workerd and natively on Node; we type only what we call.
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, callback: () => R): R;
  }
}
