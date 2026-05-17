import { describe, it, expect } from 'vitest';
import * as iso from '../index.js';

describe('public exports for item 4', () => {
  it('exports useRouteChange', () => {
    expect(typeof iso.useRouteChange).toBe('function');
  });

  it('exports Head', () => {
    expect(typeof iso.Head).toBe('function');
  });

  it('exports ClientScript', () => {
    expect(typeof iso.ClientScript).toBe('function');
  });
});
