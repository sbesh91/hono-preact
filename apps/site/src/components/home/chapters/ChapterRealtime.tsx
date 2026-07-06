import type { VNode } from 'preact';
import { LiveStage, useStageProgress } from '../scroll/stage.js';
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

// Reads the LiveStage playhead (a looping 0..1 rAF clock) to animate two
// presence cursors, a live tally, and up/down frame chips. Keeps moving
// without any scrolling because LiveStage drives it.
function LiveRoom(): VNode {
  const { progress } = useStageProgress();
  const angle = progress * 2 * Math.PI;
  const ax = 50 + Math.sin(angle) * 34;
  const ay = 50 + Math.cos(angle) * 30;
  const bx = 50 + Math.sin(angle + Math.PI) * 34;
  const by = 50 + Math.cos(angle + Math.PI) * 30;
  const tally = Math.floor(progress * 47);

  return (
    <div class="hx-rt-room">
      <span
        class="hx-rt-cursor"
        style={{ left: `${ax}%`, top: `${ay}%` }}
        aria-hidden="true"
      >
        A
      </span>
      <span
        class="hx-rt-cursor hx-rt-cursor--b"
        style={{ left: `${bx}%`, top: `${by}%` }}
        aria-hidden="true"
      >
        B
      </span>
      <output class="hx-rt-tally" aria-hidden="true">
        {tally} in room
      </output>
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
