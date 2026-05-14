import type { GuardResult } from '../guard.js';

/**
 * Passthrough guard body used by the Vite `guardStripPlugin` to replace
 * opposite-env guard bodies at build time. Importing this in user code is
 * supported but unnecessary; the plugin handles the substitution.
 */
export const __$guardNoop_hpiso = (
  _ctx: unknown,
  next: () => Promise<GuardResult>,
): Promise<GuardResult> => next();
