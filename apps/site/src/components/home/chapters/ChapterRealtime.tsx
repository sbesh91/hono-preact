import type { VNode } from 'preact';
import { LiveStage, useStageValue } from '../scroll/stage.js';
import { BrowserFrame, Wire, Lane } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';

// Rendered literally in a <pre>. Inner backticks and ${...} are escaped so the
// template literal reproduces the framework snippet verbatim.
const CODE = `const chat = defineSocket({
  data: (c) => ({ name: c.get('user').name }),
  message: (s, m) => s.send({ text: \`\${s.data.name}: \${m.text}\` }),
});
const { send, lastMessage, status } = chat.useSocket();`;

// Frames streaming both ways over the one duplex socket: a down-arrow is a
// server push (roster, a peer's cursor), an up-arrow is the browser talking
// back (its own cursor, a typing signal). Each lands at its threshold and the
// looping playhead replays them, so the traffic reads as continuous.
const FRAMES = [
  { dir: '↓', label: 'roster', at: 0.15 },
  { dir: '↑', label: 'cursor', at: 0.4 },
  { dir: '↓', label: 'cursor', at: 0.65 },
  { dir: '↑', label: 'typing', at: 0.85 },
] as const;

// A small crowd sharing one room, each on its own drift path so the space reads
// as populated and live rather than two lonely dots. The last is the local
// user; the rest are peers the server pushes in over the socket.
const PEERS = [
  { name: 'Ana', color: '#ec008c', rx: 33, ry: 27, sx: 1, sy: 1.3, ph: 0 },
  { name: 'Ben', color: '#fe5000', rx: 28, ry: 31, sx: 1.2, sy: 0.9, ph: 1.4 },
  { name: 'Cy', color: '#0a9d78', rx: 24, ry: 22, sx: 0.8, sy: 1.5, ph: 2.7 },
  { name: 'Devi', color: '#6b5cff', rx: 30, ry: 18, sx: 1.4, sy: 1.1, ph: 4.1 },
  // The local user rides the theme accent so the cursor reads in both modes
  // (a fixed ink arrow disappeared on the dark room surface).
  {
    name: 'You',
    color: 'var(--accent)',
    rx: 20,
    ry: 28,
    sx: 1.1,
    sy: 0.7,
    ph: 5.5,
  },
] as const;

// One frame chip, lighting up as its frame lands on the looping clock. Its own
// component so each chip owns its threshold and flips on its own.
function FrameChip({ dir, label, at }: (typeof FRAMES)[number]): VNode {
  const live = useStageValue((progress) => progress >= at);
  return (
    <li class="hx-rt-chip" data-live={live ? '' : undefined}>
      <span class="hx-rt-chip__dir" aria-hidden="true">
        {dir}
      </span>
      {label}
    </li>
  );
}

// The room reads the LiveStage playhead (a looping 0..1 rAF clock), so unlike
// the scroll-scrubbed chapters it never stops while it is on screen. That makes
// it the one place a per-frame render would have cost the most, and the one that
// gains the most from not doing any: each peer's drift is now a CSS
// `sin()`/`cos()` of --hx-p on its own anchor box (see .hx-rt-peer-anchor), so
// five cursors orbit continuously without this component rendering at all. The
// roster is static; only the frame chips flip, and they do it one at a time.
function LiveRoom(): VNode {
  return (
    <div class="hx-rt-room">
      {PEERS.map((p, i) => (
        // The anchor spans the room, so a percentage translate on it resolves
        // against the room's box (a translate on the little cursor itself would
        // resolve against the cursor). The -2px keeps the arrow's tip, not its
        // corner, on the point.
        <span
          key={p.name}
          class="hx-rt-peer-anchor"
          aria-hidden="true"
          style={{
            '--rx': p.rx,
            '--ry': p.ry,
            '--sx': p.sx,
            '--sy': p.sy,
            '--ph': p.ph,
          }}
        >
          <span
            class="hx-rt-peer"
            data-self={i === PEERS.length - 1 ? '' : undefined}
            style={{ '--c': p.color }}
          >
            <svg viewBox="0 0 16 16" width="15" height="15">
              <path d="M2 1.5 L2 13 L5 10.2 L7.1 14.6 L9.1 13.7 L7 9.4 L11 9.4 Z" />
            </svg>
            <span class="hx-rt-peer__name">{p.name}</span>
          </span>
        </span>
      ))}

      <div class="hx-rt-roster" aria-hidden="true">
        <span class="hx-rt-roster__avatars">
          {PEERS.map((p) => (
            <span key={p.name} class="hx-rt-avatar" style={{ '--c': p.color }}>
              {p.name[0]}
            </span>
          ))}
        </span>
        <span class="hx-rt-roster__count">{PEERS.length} in room</span>
      </div>

      <ul class="hx-rt-chips">
        {FRAMES.map((frame) => (
          <FrameChip key={frame.dir + frame.label} {...frame} />
        ))}
      </ul>
    </div>
  );
}

export function ChapterRealtime(): VNode {
  return (
    <section class="hx-chapter">
      <div class="hx-scene">
        <div class="hx-scene__head">
          <p class="hx-scene__step">
            <span class="hx-scene__num">08</span>Realtime
          </p>
          <h2 class="hx-scene__title">Live, both ways.</h2>
          <p class="hx-scene__desc">
            One typed duplex socket per client, with rooms and a presence
            roster. Use SSE when the server only pushes; reach for a WebSocket
            when the browser must talk back. On Cloudflare it fans out through
            one framework-provided Durable Object.
          </p>
        </div>
        <LiveStage periodMs={4200} fallbackProgress={0.5}>
          <div class="hx-rt-stack">
            <BrowserFrame url="/demo/cursors" live>
              <LiveRoom />
            </BrowserFrame>
            <Wire caption="network: WebSocket (duplex, ongoing)">
              <Lane label="WS /__sockets" start={0} size={0.12} tone="grad" />
            </Wire>
          </div>
        </LiveStage>
        <pre class="hx-code">
          <Code source={CODE} />
        </pre>
      </div>
    </section>
  );
}
