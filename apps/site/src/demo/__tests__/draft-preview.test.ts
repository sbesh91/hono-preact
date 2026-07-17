import { describe, it, expect, beforeEach } from 'vitest';
import { previewOf } from '../draft-preview.js';
import { resetDemoData, upsertUser } from '../data.js';

describe('previewOf', () => {
  beforeEach(() => resetDemoData());

  it('counts characters and words', () => {
    const p = previewOf('two words');
    expect(p.chars).toBe(9);
    expect(p.words).toBe(2);
    expect(p.mentions).toEqual([]);
  });

  it('treats whitespace-only drafts as zero words', () => {
    expect(previewOf('   ').words).toBe(0);
    expect(previewOf('').chars).toBe(0);
  });

  it('resolves @mentions against demo users, case-insensitively', () => {
    const p = previewOf('ping @alice and @ALICE about this');
    expect(p.mentions).toEqual(['Alice']);
  });

  it('ignores mentions that match no demo user', () => {
    expect(previewOf('@nobody hello').mentions).toEqual([]);
  });

  it('sees users created after seed time', () => {
    upsertUser('carol@example.com', 'Carol');
    expect(previewOf('cc @carol').mentions).toEqual(['Carol']);
  });
});
