import { createContext } from 'preact';

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
