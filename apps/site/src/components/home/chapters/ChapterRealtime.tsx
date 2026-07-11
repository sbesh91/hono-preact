import type { VNode } from 'preact';
import { LiveStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Wire, Lane } from '../scroll/primitives.js';
import { Code } from '../scroll/code.js';
import { useElementSize } from '../scroll/motion.js';

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

// Reads the LiveStage playhead (a looping 0..1 rAF clock) to drift each peer's
// cursor, keep a presence roster, and light up/down frame chips. Keeps moving
// without any scrolling because LiveStage drives it.
function LiveRoom(): VNode {
  const { progress } = useStageProgress();
  const t = progress * 2 * Math.PI;

  // The peers drift continuously (this clock never stops while the chapter is
  // in view, unlike the scroll-scrubbed demos elsewhere on the page), so their
  // position is a measured-px `transform` rather than a `left`/`top`
  // percentage: that keeps a sustained per-frame animation off layout.
  const [roomRef, room] = useElementSize<HTMLDivElement>();

  return (
    <div class="hx-rt-room" ref={roomRef}>
      {PEERS.map((p, i) => {
        const xPct = 50 + Math.sin(t * p.sx + p.ph) * p.rx;
        const yPct = 50 + Math.cos(t * p.sy + p.ph) * p.ry;
        // -2px keeps the arrow's tip (not its top-left corner) on the point,
        // matching the CSS `transform: translate(-2px, -2px)` this replaces.
        const x = (xPct / 100) * room.width - 2;
        const y = (yPct / 100) * room.height - 2;
        return (
          <span
            key={p.name}
            class="hx-rt-peer"
            data-self={i === PEERS.length - 1 ? '' : undefined}
            style={{ transform: `translate(${x}px, ${y}px)`, '--c': p.color }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16" width="15" height="15">
              <path d="M2 1.5 L2 13 L5 10.2 L7.1 14.6 L9.1 13.7 L7 9.4 L11 9.4 Z" />
            </svg>
            <span class="hx-rt-peer__name">{p.name}</span>
          </span>
        );
      })}

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
        {FRAMES.map((frame) => {
          const live = progress >= frame.at;
          return (
            <li
              key={frame.dir + frame.label}
              class="hx-rt-chip"
              data-live={live ? '' : undefined}
            >
              <span class="hx-rt-chip__dir" aria-hidden="true">
                {frame.dir}
              </span>
              {frame.label}
            </li>
          );
        })}
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
