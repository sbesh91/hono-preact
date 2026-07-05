import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Form needs only the brand SYMBOL from the optimistic feature (for the
// `OPTIMISTIC_BRAND in action` narrowing), not the optimistic runtime. It must
// import the symbol from the dependency-free leaf, NOT from optimistic-action.js
// whose graph pulls optimistic.js (useOptimistic). Keeping that static edge out
// of form.js is what lets a bundler avoid co-locating optimistic.js into a plain
// (non-optimistic) form route's chunk (REVIEW.md §5, "pay only for what you use").
const formJs = readFileSync(resolve('packages/iso/dist/form.js'), 'utf8');

describe('optimistic brand leaf', () => {
  it('form does not statically import the optimistic-action module', () => {
    expect(formJs).not.toMatch(/from\s*["']\.\/optimistic-action\.js["']/);
  });

  it('form sources the brand symbol from the dependency-free leaf', () => {
    expect(formJs).toMatch(/from\s*["']\.\/internal\/optimistic-brand\.js["']/);
  });
});
