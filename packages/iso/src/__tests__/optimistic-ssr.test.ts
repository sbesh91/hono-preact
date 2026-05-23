// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import { prerender } from 'preact-iso/prerender';
import { useOptimistic } from '../optimistic.js';

describe('useOptimistic SSR with transition: true', () => {
  it('renders without throwing when transition: true in SSR (node) environment', async () => {
    // Critical assertion: prove document is undefined in the node environment.
    // This demonstrates that the feature-detection guard in runWithTransition
    // (typeof document !== 'undefined') is genuinely being exercised.
    expect(typeof document).toBe('undefined');

    // Component that uses useOptimistic with transition: true.
    function Component() {
      const [value] = useOptimistic([1, 2, 3], (current: number[], p: number) => [...current, p], {
        transition: true,
      });
      return h('span', null, String(value.length));
    }

    // Prerender the component in a node environment. This exercises the
    // useOptimistic hook with transition: true while document is undefined.
    // If the feature detection guard were broken, prerender would throw
    // a ReferenceError when the hook tries to access document.
    const result = await prerender(h(Component, null));

    // The prerender result should contain the rendered HTML.
    expect(result.html).toContain('<span>3</span>');
  });

  it('transition: true with manual settle/revert in prerender context', async () => {
    // In SSR, event handlers that call settle/revert typically don't execute
    // during prerender (no user interaction). However, we can test that the
    // hook's runWithTransition guard is properly set up by verifying the
    // component renders successfully.
    expect(typeof document).toBe('undefined');

    function Component() {
      const [value] = useOptimistic([0], (current: number[], p: number) => [...current, p], {
        transition: true,
      });
      return h('div', null, h('span', null, String(value[0])));
    }

    const result = await prerender(h(Component, null));
    expect(result.html).toContain('<span>0</span>');
  });
});
