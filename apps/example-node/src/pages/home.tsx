import { definePage, useAction, useSocket } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { serverLoaders, serverActions } from './home.server.js';
import { serverSockets } from './chat.server.js';

const homeLoader = serverLoaders.default;
const countLoader = serverLoaders.count;

const HomePage: FunctionComponent = () => {
  const { message } = homeLoader.useData();
  return (
    <section>
      <h1>example-node</h1>
      <p>{message}</p>
      <LiveCounter />
      <ChatDemo />
      <a href="/about">About</a>
    </section>
  );
};
HomePage.displayName = 'HomePage';

// Accumulating live view: data is the latest count pushed over the channel.
// Open two tabs and click Increment in one; both update live.
const LiveCounter = countLoader.View<number>(
  ({ data, status }) => {
    const inc = useAction(serverActions.increment);
    return (
      <p>
        Live count: <strong>{data}</strong> ({status}){' '}
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
    fallback: <p>Live count: connecting...</p>,
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

  const sock = useSocket(serverSockets.chat, { onMessage });

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

const HomeView = homeLoader.View(() => <HomePage />, {
  fallback: <p>Loading...</p>,
});

export default definePage(HomeView, {});
