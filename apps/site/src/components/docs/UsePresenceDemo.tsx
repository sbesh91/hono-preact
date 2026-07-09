import { usePresence } from 'hono-preact-ui';
import { useState } from 'preact/hooks';

// A box that mounts on open and animates out on close using usePresence. The
// styling lives in apps/site/src/styles/docs.css (.docs-presence*).
export function UsePresenceDemo() {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  return (
    <div class="docs-presence">
      <button class="docs-presence-trigger" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'}
      </button>
      {presence.isPresent ? (
        <div
          ref={presence.ref}
          class="docs-presence-box"
          data-state={presence.status === 'open' ? 'open' : 'closed'}
        >
          I fade + slide out before unmounting.
        </div>
      ) : null}
    </div>
  );
}
