import { describe, it, expect } from 'vitest';
import { render, isRender } from '@hono-preact/iso/page';

describe('@hono-preact/iso/page subpath', () => {
  it('exports render() resolvable through the subpath', () => {
    const o = render(() => null);
    expect(isRender(o)).toBe(true);
  });
});
