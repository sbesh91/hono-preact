export type WrapStatus = 'pending' | 'success' | 'error';

export function wrapPromise<T>(promise: Promise<T>) {
  let status: WrapStatus = 'pending';
  let result: T;
  let error: unknown;

  // `settled` resolves (never rejects) once the source settles either way, so a
  // consumer can subscribe to resume without catching its own thrown suspender.
  const settled = promise.then(
    (res) => {
      status = 'success';
      result = res;
    },
    (err) => {
      status = 'error';
      error = err;
    }
  );

  const read = () => {
    switch (status) {
      case 'pending':
        throw settled;
      case 'error':
        throw error;
      default:
        return result;
    }
  };

  const peek = () => ({ status, settled });

  return { read, peek };
}

export default wrapPromise;
