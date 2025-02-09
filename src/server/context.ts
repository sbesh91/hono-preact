import { signal } from "@preact/signals";
import type { Context } from "hono";

export const context = signal<Context>();
