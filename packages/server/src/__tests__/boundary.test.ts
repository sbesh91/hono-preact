import { describe, expect, it } from 'vitest';
import * as publicEntry from '../index.js';
import * as runtime from '../internal-runtime.js';

const INTERNALIZED_FACTORIES = [
  'routeServerModules',
  'makePageUseResolver',
  'makePageActionResolvers',
] as const;

const INTERNALIZED_HANDLERS = ['loadersHandler', 'pageActionsHandler'] as const;

describe('server boundary', () => {
  it('exposes createServerEntry on /internal/runtime', () => {
    expect(typeof runtime.createServerEntry).toBe('function');
  });

  it('does not re-surface the resolver factories from /internal/runtime', () => {
    for (const name of INTERNALIZED_FACTORIES) {
      expect(name in runtime).toBe(false);
    }
  });

  it('surfaces the SSR + context public API on the public entry', () => {
    expect(typeof publicEntry.renderPage).toBe('function');
    expect(typeof publicEntry.HonoContext).toBe('function');
    expect(typeof publicEntry.useHonoContext).toBe('function');
  });

  it('does not surface the internalized handlers from the public entry', () => {
    for (const name of INTERNALIZED_HANDLERS) {
      expect(name in publicEntry).toBe(false);
    }
  });

  it('does not surface the internalized factories from the public entry', () => {
    for (const name of INTERNALIZED_FACTORIES) {
      expect(name in publicEntry).toBe(false);
    }
  });
});
