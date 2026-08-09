import { createContext } from 'preact';
import type { DenyRecord } from './internal/deny-record.js';

export type ActionResultContextValue =
  | {
      module: string;
      action: string;
      kind: 'success';
      data: unknown;
      submittedPayload: unknown;
    }
  | (DenyRecord & {
      module: string;
      action: string;
      kind: 'deny';
      submittedPayload: unknown;
    })
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
