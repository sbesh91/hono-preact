import type { Context } from "hono";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

export const HonoContext = createContext<{ context?: Context }>({});

export function useHonoContext() {
  return useContext(HonoContext);
}
