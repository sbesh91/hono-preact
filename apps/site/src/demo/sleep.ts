// Abort-aware sleep shared by the demo's deliberately-slow server paths, so
// a loader/action timeout abort actually stops the wait.
export const sleepMs = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
