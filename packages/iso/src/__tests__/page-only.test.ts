import { describe, it, expect } from 'vitest';
import { render, isRender } from '../page-only.js';

describe('render() (page-scope subpath)', () => {
  it('constructs a render outcome with the given component', () => {
    const C = () => null;
    const o = render(C);
    expect(o).toEqual({ __outcome: 'render', Component: C });
  });

  it('result is recognized by isRender', () => {
    expect(isRender(render(() => null))).toBe(true);
  });
});
