import { describe, it, expect } from 'vitest';
import {
  render,
  redirect,
  deny,
  isOutcome,
  isRedirect,
  isDeny,
  isRender,
} from '@hono-preact/iso/page';

describe('@hono-preact/iso/page subpath', () => {
  it('exports render() resolvable through the subpath', () => {
    const o = render(() => null);
    expect(isRender(o)).toBe(true);
  });

  it('exports redirect() resolvable through the subpath', () => {
    const o = redirect('/somewhere');
    expect(isRedirect(o)).toBe(true);
    expect(o.to).toBe('/somewhere');
  });

  it('exports deny() resolvable through the subpath', () => {
    const o = deny(403);
    expect(isDeny(o)).toBe(true);
    expect(o.status).toBe(403);
  });

  it('exports the outcome predicates through the subpath', () => {
    expect(isOutcome(redirect('/'))).toBe(true);
    expect(isOutcome(null)).toBe(false);
  });
});
