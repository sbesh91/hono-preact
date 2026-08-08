import { definePage, useTitle, useComputed, For, Show } from 'hono-preact';
import type { JSX, FunctionComponent } from 'preact';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { serverRooms } from './cursors-demo.server.js';

// Cap presence broadcasts at ~60/s (one per frame). Pointer events fire much
// faster (often >100/s); without throttling, every move sends a WebSocket frame
// and floods the socket.
const PRESENCE_INTERVAL_MS = 16;

// Live-cursors demo: all members in the 'demo' room see each other's pointer
// positions as small colored overlays fanned out via the Durable Object
// (HONO_PREACT_REALTIME binding). Open two browser tabs and move the pointer
// in one to see it appear in the other, cross-isolate.
const CursorsDemo: FunctionComponent = () => {
  useTitle('Live cursors');
  const room = serverRooms.cursors.useRoom({
    key: { room: 'demo' },
    presence: { x: 0, y: 0 },
  });
  const { setPresence } = room;

  // Throttle presence sends to at most one per PRESENCE_INTERVAL_MS via a single
  // trailing timer that always flushes the LATEST position. Trailing (not just
  // leading) so the remote cursor settles exactly where the pointer stopped,
  // never a frame behind.
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const lastSentRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerMove = useCallback(
    (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      pendingRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      // A flush is already scheduled; it will pick up this latest position.
      if (flushTimerRef.current !== null) return;
      const wait = Math.max(
        0,
        PRESENCE_INTERVAL_MS - (performance.now() - lastSentRef.current)
      );
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        if (pendingRef.current === null) return;
        setPresence(pendingRef.current);
        pendingRef.current = null;
        lastSentRef.current = performance.now();
      }, wait);
    },
    [setPresence]
  );

  // Drop a pending trailing send if the component unmounts mid-throttle.
  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    },
    []
  );

  // Membership only: the page subscribes to WHO is here (memberIds, changes on
  // join/leave), never to presence. Each cursor row binds to member(id) below,
  // so pointer traffic re-renders one dot, not this page.
  const otherIds = useComputed(() =>
    room.memberIds.value.filter((id) => id !== room.self.value?.id)
  );
  const othersEmpty = useComputed(() => otherIds.value.length === 0);
  const memberCount = useComputed(() => room.memberIds.value.length);

  return (
    <div class="grid min-h-screen place-items-center bg-background px-4">
      <div class="w-full max-w-xl rounded-2xl border border-border bg-surface-subtle p-8 shadow-sm space-y-4">
        <div>
          <h1 class="text-xl font-bold text-foreground">Live cursors</h1>
          <p class="mt-1 text-sm text-muted">
            Move your pointer inside the box. Open this page in a second tab to
            see cursors fan out cross-isolate through the Durable Object.
          </p>
        </div>

        <div class="flex items-center gap-2 text-sm text-muted">
          <span
            class={[
              'inline-block w-2 h-2 rounded-full',
              room.status === 'open' ? 'bg-green-500' : 'bg-amber-400',
            ].join(' ')}
          />
          <span>
            {room.status === 'open' ? 'Connected' : 'Connecting...'} &middot;{' '}
            {memberCount.value} {memberCount.value === 1 ? 'member' : 'members'}{' '}
            in room
          </span>
        </div>

        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '240px',
            overflow: 'hidden',
            cursor: 'crosshair',
          }}
          class="rounded-lg border border-border bg-background"
          onPointerMove={handlePointerMove}
        >
          {room.status === 'open' && (
            <Show when={othersEmpty}>
              <span class="absolute inset-0 flex items-center justify-center text-sm text-muted pointer-events-none select-none">
                No other members yet. Open a second tab.
              </span>
            </Show>
          )}
          {room.status !== 'open' && (
            <span class="absolute inset-0 flex items-center justify-center text-sm text-muted pointer-events-none select-none">
              Connecting to room...
            </span>
          )}
          <For each={otherIds}>
            {(id) => {
              // member(id) is a per-member signal: presence moves re-render
              // this row (one dot) and nothing else.
              const member = room.member(id.value).value;
              return (
                <div
                  style={{
                    position: 'absolute',
                    left: `${member?.state?.x ?? 0}px`,
                    top: `${member?.state?.y ?? 0}px`,
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                  }}
                  title={id.value.slice(0, 6)}
                />
              );
            }}
          </For>
        </div>

        <Show when={room.self}>
          {(self) => (
            <p class="text-xs text-muted">
              You are <code class="font-mono">{self.id.slice(0, 8)}</code>
            </p>
          )}
        </Show>

        <footer class="border-t border-border pt-4 text-xs text-muted">
          Powered by{' '}
          <a href="/docs/rooms" class="underline hover:text-foreground">
            Rooms + Durable Objects
          </a>
          .{' '}
          <a href="/demo" class="underline hover:text-foreground">
            Back to demo
          </a>
        </footer>
      </div>
    </div>
  );
};
CursorsDemo.displayName = 'CursorsDemo';

export default definePage(CursorsDemo, {});
