import { describe, expect, it } from 'vitest';
import * as publicEntry from '../index.js';
import * as runtime from '../internal-runtime.js';
// Type-surface check: this import + usage fails `tsc` if the re-export is
// missing. Vitest strips types, so the real enforcement is `pnpm typecheck`.
import type { LoadersHandlerOptions } from '../index.js';

const _loadersHandlerOptions: LoadersHandlerOptions = {};
void _loadersHandlerOptions;

const FACTORIES = [
  'routeServerModules',
  'makePageUseResolver',
  'makePageActionResolvers',
] as const;

describe('server boundary', () => {
  it('exposes the framework-emitted factories on /internal/runtime as functions', () => {
    for (const name of FACTORIES) {
      expect(typeof (runtime as Record<string, unknown>)[name]).toBe(
        'function'
      );
    }
  });

  it('does not re-export the factories from the public entry', () => {
    for (const name of FACTORIES) {
      expect(name in publicEntry).toBe(false);
    }
  });

  it('keeps the public handler surface available', () => {
    expect(typeof publicEntry.renderPage).toBe('function');
    expect(typeof publicEntry.loadersHandler).toBe('function');
    expect(typeof publicEntry.pageActionHandler).toBe('function');
  });
});
