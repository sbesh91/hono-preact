import { describe, expect, it } from 'vitest';
import { docsSlug } from '../../../components/DocsRoute.js';

describe('docsSlug', () => {
  it('maps a top-level file to its bare slug', () => {
    expect(docsSlug('../pages/docs/quick-start.mdx')).toBe('quick-start');
  });

  it('maps the root index to the empty slug', () => {
    expect(docsSlug('../pages/docs/index.mdx')).toBe('');
  });

  it('keeps subdirectory segments for nested files', () => {
    expect(docsSlug('../pages/docs/components/dialog.mdx')).toBe(
      'components/dialog'
    );
  });

  it('maps a nested index to its directory slug', () => {
    expect(docsSlug('../pages/docs/components/index.mdx')).toBe('components');
  });
});
