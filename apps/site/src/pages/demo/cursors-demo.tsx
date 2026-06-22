import { definePage } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useCallback } from 'preact/hooks';
import { serverRooms } from './cursors-demo.server.js';

// Live-cursors demo: all members in the 'demo' room see each other's pointer
// positions as small colored overlays fanned out via the Durable Object
// (HONO_PREACT_REALTIME binding). Open two browser tabs and move the pointer
// in one to see it appear in the other, cross-isolate.
const CursorsDemo: FunctionComponent = () => {
  const room = serverRooms.cursors.useRoom({
    key: { room: 'demo' },
    presence: { x: 0, y: 0 },
  });

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      room.setPresence({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [room]
  );

  const others = room.members.filter((m) => m.id !== room.self?.id);

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
            {room.members.length}{' '}
            {room.members.length === 1 ? 'member' : 'members'} in room
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
          {others.length === 0 && room.status === 'open' && (
            <span class="absolute inset-0 flex items-center justify-center text-sm text-muted pointer-events-none select-none">
              No other members yet. Open a second tab.
            </span>
          )}
          {room.status !== 'open' && (
            <span class="absolute inset-0 flex items-center justify-center text-sm text-muted pointer-events-none select-none">
              Connecting to room...
            </span>
          )}
          {others.map((member) => (
            <div
              key={member.id}
              style={{
                position: 'absolute',
                left: `${member.state?.x ?? 0}px`,
                top: `${member.state?.y ?? 0}px`,
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: '#e05',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
              title={member.id.slice(0, 6)}
            />
          ))}
        </div>

        {room.self && (
          <p class="text-xs text-muted">
            You are <code class="font-mono">{room.self.id.slice(0, 8)}</code>
          </p>
        )}

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
