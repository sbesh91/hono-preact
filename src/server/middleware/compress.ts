import { compress } from "hono/compress";
import { noopMiddleware } from "./noop";

export const compression = () => {
  if (process.env.NODE_ENV === "production") {
    return compress();
  }

  return noopMiddleware;
};
