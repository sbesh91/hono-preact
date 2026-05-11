import { createContext } from 'preact';
import type { GuardResult } from '../guard.js';

export const LoaderIdContext = createContext<string | null>(null);

export const LoaderDataContext = createContext<{
  data: unknown;
} | null>(null);

export const GuardResultContext = createContext<GuardResult | null>(null);

export const ActiveLoaderIdContext = createContext<symbol | null>(null);

export const LoaderErrorContext = createContext<Error | null>(null);
