import type { VNode } from 'preact';
import { LiveStage, useStageProgress } from '../scroll/stage.js';
import { BrowserFrame, Wire, Lane } from '../scroll/primitives.js';

// Rendered literally in a <pre>. Inner backticks and ${...} are escaped so the
// template literal reproduces the framework snippet verbatim.
const CODE = `const chat = defineSocket({
  data: (c) => ({ name: c.get('user').name }),
  message: (s, m) => s.send({ text: \`\${s.data.name}: \${m.text}\` }),
});
const { send, lastMessage, status } = chat.useSocket();`;

// Progress thresholds at which each frame chip flips from "down" to "up".
const CHIP_THRESHOLDS = [0.2, 0.4, 0.6, 0.8];

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
        {CHIP_THRESHOLDS.map((threshold, i) => {
          const up = progress >= threshold;
          return (
            <li
              key={threshold}
              class="hx-rt-chip"
              data-dir={up ? 'up' : 'down'}
            >
              {up ? 'up' : 'down'} frame {i + 1}
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
          <p class="hx-scene__step">Realtime</p>
          <h2 class="hx-scene__title">Live, both ways.</h2>
          <p class="hx-scene__desc">
            One typed duplex socket per client, with rooms and a presence
            roster. Use SSE when the server only pushes; reach for a WebSocket
            when the browser must talk back. On Cloudflare it fans out through
            one framework-provided Durable Object.
          </p>
        </div>
        <div class="hx-panels hx-cols2">
          <LiveStage periodMs={4200} fallbackProgress={0.5}>
            <BrowserFrame url="/demo/cursors" live>
              <LiveRoom />
            </BrowserFrame>
            <Wire caption="network: WebSocket (duplex, ongoing)">
              <Lane label="WS /__sockets" start={0} size={0.12} tone="grad" />
            </Wire>
          </LiveStage>
          <pre class="hx-code">
            <code>{CODE}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
