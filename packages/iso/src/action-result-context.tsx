import { createContext } from 'preact';
import type { DenyCode } from './outcomes.js';

export type ActionResultContextValue =
  | {
      module: string;
      action: string;
      kind: 'success';
      data: unknown;
      submittedPayload: unknown;
    }
  | {
      module: string;
      action: string;
      kind: 'deny';
      status: number;
      message: string;
      data?: unknown;
      code?: DenyCode;
      submittedPayload: unknown;
    }
  | {
      module: string;
      action: string;
      kind: 'error';
      message: string;
      submittedPayload: unknown;
    }
  | null;

export const ActionResultContext =
  createContext<ActionResultContextValue>(null);
