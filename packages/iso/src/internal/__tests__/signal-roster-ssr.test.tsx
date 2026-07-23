// @vitest-environment node
// Finding #2 from the whole-branch review: importing the signals entry installs
// @preact/signals' global preact `options` hooks, and this framework has prior
// scar tissue (#287) with options-patching breaking preact-render-to-string.
// Only the DEFAULT-impl SSR path was covered. This renders a component that
// reads the signal-backed roster (memberIds/members/member) to a STRING with the
// signals options active, and asserts it neither throws nor connects, and yields
// the empty first-render roster that hydration parity depends on.
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import {
  getPresenceReactiveImpl,
  registerPresenceReactiveImpl,
} from '../reactive.js';
import { installPresenceSignals } from '../../signals.js';

describe('signal roster under preact-render-to-string', () => {
  it('renders empty-roster reads to a string without throwing (options patches active)', () => {
    installPresenceSignals();
    try {
      const store = getPresenceReactiveImpl()!.createRoster<{ x: number }>();

      function View() {
        return (
          <ul data-ids={store.memberIds.value.join(',')}>
            <li data-count={String(store.members.value.length)}>
              {String(store.member('nobody').value?.state?.x ?? 'none')}
            </li>
          </ul>
        );
      }

      // The load-bearing assertion is simply that this does not throw with the
      // signals `options` hooks active during render-to-string (finding #2).
      const html = renderToString(<View />);
      // And the empty first-render roster hydration parity depends on: no ids
      // (empty-string attr renders bare), zero members, absent member undefined.
      expect(html).toContain('data-ids');
      expect(html).not.toContain('data-ids="');
      expect(html).toContain('data-count="0"');
      expect(html).toContain('none');
    } finally {
      registerPresenceReactiveImpl(null);
    }
  });
});
