import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyHeading, analyzePageStructure } from '../docs-structure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../src/pages/docs');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.mdx') && e.name !== 'index.mdx' ? [p] : [];
  });
}

describe('classifyHeading', () => {
  it('buckets headings', () => {
    expect(classifyHeading('API reference')).toBe('reference');
    expect(classifyHeading('`.View()` options reference')).toBe('reference');
    expect(classifyHeading('How it works')).toBe('nuance');
    expect(classifyHeading('Demo')).toBe('example');
    expect(classifyHeading('Example: listing page')).toBe('example');
    expect(classifyHeading('See also')).toBe('neutral');
    expect(classifyHeading('API routes alongside middleware')).toBe('neutral');
  });
});

describe('analyzePageStructure', () => {
  it('passes a conformant page', () => {
    expect(
      analyzePageStructure(
        '# T\nlead.\n\n## Example\n```\nx\n```\n\n## How it works\np\n\n## API reference\n| a |\n'
      )
    ).toEqual([]);
  });
  it('flags R1 (nuance before example)', () => {
    expect(
      analyzePageStructure(
        '# T\nlead.\n\n## How it works\np\n\n## Example\n```\nx\n```\n'
      ).some((p) => p.rule === 'R1')
    ).toBe(true);
  });
  it('flags R2 (example after reference)', () => {
    expect(
      analyzePageStructure(
        '# T\nlead.\n\n## API reference\n| a |\n\n## Example\n```\nx\n```\n'
      ).some((p) => p.rule === 'R2')
    ).toBe(true);
  });
  it('flags R3 (no lead)', () => {
    expect(
      analyzePageStructure('# T\n```\nx\n```\n').some((p) => p.rule === 'R3')
    ).toBe(true);
  });
});

const EXPECTED_VIOLATORS = [
  'actions.mdx',
  'live-loaders.mdx',
  'loaders.mdx',
  'realtime.mdx',
  'structure.mdx',
  'prefetch.mdx',
  'components/merge-refs.mdx',
  'components/render-element.mdx',
  'components/use-controllable-state.mdx',
  'components/use-dismiss.mdx',
  'components/use-focus-return.mdx',
  'components/use-list-navigation.mdx',
  'components/use-positioner.mdx',
  'components/use-presence.mdx',
  'components/use-safe-area.mdx',
  'components/use-typeahead.mdx',
].sort();

// Fidelity guard for THIS task only. Deleted in Task 48 once every page conforms
// (then the gate asserts zero violators). Keeps the classifier honest mid-sweep.
describe('classifier fidelity (pre-sweep snapshot)', () => {
  it('flags exactly the 16 known violators', () => {
    const flagged = walk(docsDir)
      .filter((f) => analyzePageStructure(readFileSync(f, 'utf8')).length > 0)
      .map((f) => relative(docsDir, f))
      .sort();
    expect(flagged).toEqual(EXPECTED_VIOLATORS);
  });
});
