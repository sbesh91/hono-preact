export function wrapPromise<T>(promise: Promise<T>) {
  let status = "pending";
  let result: T;
  let error: unknown;

  const suspender = promise.then(
    (res) => {
      status = "success";
      result = res;
    },
    (err) => {
      status = "error";
      error = err;
    }
  );

  const read = () => {
    switch (status) {
      case "pending":
        throw suspender;
      case "error":
        throw error;
      default:
        return result;
    }
  };

  return { read };
}

export default wrapPromise;
