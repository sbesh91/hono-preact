import { createContext } from 'preact';
import type { GuardResult } from '../guard.js';

export const LoaderIdContext = createContext<string | null>(null);

export const LoaderDataContext = createContext<{
  refId: symbol;
  data: unknown;
} | null>(null);

export const GuardResultContext = createContext<GuardResult | null>(null);
