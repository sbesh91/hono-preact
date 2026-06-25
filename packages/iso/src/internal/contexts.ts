import type { Context } from 'hono';
import { createContext } from 'preact';

export const HonoRequestContext = createContext<{ context?: Context }>({});

export const LoaderIdContext = createContext<string | null>(null);

export const LoaderDataContext = createContext<{
  data: unknown;
  loading: boolean;
} | null>(null);

export const ActiveLoaderIdContext = createContext<symbol | null>(null);

export const LoaderErrorContext = createContext<Error | null>(null);
