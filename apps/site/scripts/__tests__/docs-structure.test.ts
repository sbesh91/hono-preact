import { describe, it, expect } from 'vitest';
import { classifyHeading, analyzePageStructure } from '../docs-structure.mjs';

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
