import { describe, it, expect } from 'vitest';
import { speculationRulesTag, SPECULATION_RULES_TAG } from '../speculation-rules.js';

describe('speculationRulesTag', () => {
  it('returns the empty string when speculation is omitted', () => {
    expect(speculationRulesTag({})).toBe('');
  });

  it('returns the empty string when speculation is false', () => {
    expect(speculationRulesTag({ speculation: false })).toBe('');
  });

  it('returns the tag when speculation is true', () => {
    expect(speculationRulesTag({ speculation: true })).toBe(SPECULATION_RULES_TAG);
  });

  it('emitted tag is byte-stable', () => {
    expect(SPECULATION_RULES_TAG).toBe(
      '<script type="speculationrules">' +
        '{"prefetch":[{"where":{"and":[' +
        '{"href_matches":"/*"},' +
        '{"not":{"selector_matches":"[data-no-prefetch]"}}' +
        ']},"eagerness":"moderate"}]}' +
        '</script>'
    );
  });

  it('emitted JSON is parseable and well-formed', () => {
    const match = SPECULATION_RULES_TAG.match(
      /^<script type="speculationrules">(.*)<\/script>$/
    );
    expect(match).not.toBeNull();
    const json = JSON.parse(match![1]);
    expect(json).toEqual({
      prefetch: [
        {
          where: {
            and: [
              { href_matches: '/*' },
              { not: { selector_matches: '[data-no-prefetch]' } },
            ],
          },
          eagerness: 'moderate',
        },
      ],
    });
  });
});
