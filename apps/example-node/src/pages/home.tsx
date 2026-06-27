import { definePage, useAction } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { serverLoaders, serverActions } from './home.server.js';
import { serverSockets } from './chat.server.js';
import { serverRooms } from './cursors.server.js';

const homeLoader = serverLoaders.default;
const countLoader = serverLoaders.count;

const HomePage: FunctionComponent = () => {
  const { data } = homeLoader.useData();
  if (!data) return <p>Loading...</p>;
  const { message } = data;
  return (
    <section>
      <h1>example-node</h1>
      <p>{message}</p>
      <LiveCounter />
      <ChatDemo />
      <CursorsDemo />
      <a href="/about">About</a>
    </section>
  );
};
HomePage.displayName = 'HomePage';

// Accumulating live view: data is the latest count pushed over the channel.
// Open two tabs and click Increment in one; both update live.
const LiveCounter = countLoader.View<number>(
  (s) => {
    const inc = useAction(serverActions.increment);
    // Only `open`/`closed` carry the accumulated count; `connecting` and a cold
    // `error` (the connect failed before the first chunk) carry no data, so fall
    // back to the initial count (0) rather than dereferencing `s.data`.
    const count = s.status === 'open' || s.status === 'closed' ? s.data : 0;
    return (
      <p>
        Live count: <strong>{count}</strong> ({s.status})
        {s.status === 'error' && <> error: {s.error.message}</>}{' '}
        <button
          type="button"
          disabled={inc.pending}
          onClick={() => inc.mutate({})}
        >
          Increment
        </button>
      </p>
    );
  },
  {
    initial: 0,
    reduce: (_acc, chunk) => chunk.count,
  }
);
LiveCounter.displayName = 'LiveCounter';

// Duplex socket demo: echo + per-connection server tick.
const ChatDemo: FunctionComponent = () => {
  const [tickN, setTickN] = useState<number | null>(null);
  const [echoLog, setEchoLog] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');

  const onMessage = useCallback(
    (msg: { kind: string; text?: string; n?: number }) => {
      if (msg.kind === 'tick' && typeof msg.n === 'number') {
        setTickN(msg.n);
      } else if (msg.kind === 'echo' && typeof msg.text === 'string') {
        // Capture the narrowed value so the updater closure sees `string`.
        const text = msg.text;
        setEchoLog((prev) => [...prev, text]);
      }
    },
    []
  );

  const sock = serverSockets.chat.useSocket({ onMessage });

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    sock.send({ kind: 'say', text });
    setInputText('');
  }, [inputText, sock]);

  return (
    <div>
      <h2>Chat socket ({sock.status})</h2>
      <p>Server tick: {tickN ?? '—'}</p>
      <div>
        <input
          type="text"
          value={inputText}
          onInput={(e) => setInputText((e.target as HTMLInputElement).value)}
          placeholder="Type a message"
        />
        <button
          type="button"
          disabled={sock.status !== 'open'}
          onClick={handleSend}
        >
          Send
        </button>
      </div>
      {echoLog.length > 0 && (
        <ul>
          {echoLog.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
ChatDemo.displayName = 'ChatDemo';

// Live-cursors demo: all members in the 'demo' room see each other's pointer
// positions as small colored overlays. On pointermove, the client sends its
// cursor position as a presence update (not a message); the framework fans the
// presence delta out to all other members. Each member renders a dot for every
// OTHER member (self is excluded: the OS cursor is already visible, and rendering
// your own position introduces lag).
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
    <div>
      <h2>Live cursors ({room.status})</h2>
      <p>
        Members: {room.members.length} (you are{' '}
        {room.self ? `member ${room.self.id.slice(0, 6)}` : 'connecting...'})
      </p>
      <div
        style={{
          position: 'relative',
          width: '400px',
          height: '200px',
          border: '1px solid #ccc',
          overflow: 'hidden',
          cursor: 'crosshair',
        }}
        onPointerMove={handlePointerMove}
      >
        <span style={{ userSelect: 'none', pointerEvents: 'none' }}>
          Move your pointer here to share your cursor position.
        </span>
        {others.map((member) => (
          <div
            key={member.id}
            style={{
              position: 'absolute',
              left: `${member.state?.x ?? 0}px`,
              top: `${member.state?.y ?? 0}px`,
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#e05',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
            title={member.id.slice(0, 6)}
          />
        ))}
      </div>
    </div>
  );
};
CursorsDemo.displayName = 'CursorsDemo';

const HomeView = homeLoader.View(({ data }) =>
  data ? <HomePage /> : <p>Loading...</p>
);

export default definePage(HomeView, {});
