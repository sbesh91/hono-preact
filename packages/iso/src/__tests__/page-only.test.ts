import { describe, it, expect } from 'vitest';
import {
  render,
  redirect,
  deny,
  isOutcome,
  isRedirect,
  isDeny,
  isRender,
} from '../page-only.js';

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

describe('@hono-preact/iso/page kitchen-sink re-exports', () => {
  it('re-exports redirect and the result is a redirect outcome', () => {
    const o = redirect('/login');
    expect(isRedirect(o)).toBe(true);
    expect(o.to).toBe('/login');
  });

  it('re-exports deny and the result is a deny outcome', () => {
    const o = deny(403, 'nope');
    expect(isDeny(o)).toBe(true);
    expect(o.status).toBe(403);
  });

  it('re-exports the predicates so they recognize all three outcomes', () => {
    expect(isOutcome(redirect('/'))).toBe(true);
    expect(isOutcome(deny(401))).toBe(true);
    expect(isOutcome(render(() => null))).toBe(true);
    expect(isOutcome({})).toBe(false);
    expect(isRender(deny(403))).toBe(false);
    expect(isDeny(redirect('/'))).toBe(false);
    expect(isRedirect(render(() => null))).toBe(false);
  });
});
