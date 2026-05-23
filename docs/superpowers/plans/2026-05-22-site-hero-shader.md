# Homepage Hero Shader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an animated warm-plasma WebGL shader behind the marketing homepage hero, fading gradually into white, with soft-shadowed content cards.

**Architecture:** A new client-only `HeroShader` Preact component renders an absolutely positioned `<canvas>` + fade-overlay `<div>` behind the homepage `<main>`. Raw WebGL2 (no Three.js) runs a small four-term sine-field plasma in a single fragment shader, with a CSS-gradient fallback when WebGL2 is unavailable. Existing `Card` and `CodeBlock` blocks gain a `shadow-card` Tailwind utility so they lift off the gradient.

**Tech Stack:** Preact (with `preact/hooks`), TypeScript, raw WebGL2, Tailwind v4 (`@utility` in `apps/site/src/styles/root.css`), Vitest + `@testing-library/preact` + happy-dom for tests. Site lives in `apps/site` under the existing pnpm workspace.

Spec: `docs/superpowers/specs/2026-05-22-site-hero-shader-design.md`.

---

## File structure

- **New:** `apps/site/src/components/HeroShader.tsx` — the canvas + fade overlay + WebGL bootstrap.
- **New:** `apps/site/src/components/__tests__/HeroShader.test.tsx` — render/unmount tests using happy-dom.
- **Modified:** `apps/site/src/styles/root.css` — add `@utility shadow-card`.
- **Modified:** `apps/site/src/pages/home.tsx` — wrap content in a positioned container, mount `<HeroShader />`, swap `Card` and `CodeBlock` classes to use `shadow-card`.
- **Modified:** `apps/site/src/pages/__tests__/home.test.tsx` — add an assertion that the shader element is mounted.

Each task below produces a self-contained, committable change.

---

## Task 1: Add the `shadow-card` Tailwind utility

**Files:**
- Modify: `apps/site/src/styles/root.css`

This is a small CSS-only change that other tasks depend on. Tailwind v4 reads `@utility` blocks from the imported stylesheet.

- [ ] **Step 1: Add the `shadow-card` utility to `root.css`**

Open `apps/site/src/styles/root.css`. Immediately after the existing `@import 'tailwindcss';` line, insert:

```css
@utility shadow-card {
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 16px rgba(16, 24, 40, 0.08);
}
```

The rest of the file stays as-is.

- [ ] **Step 2: Verify the build still succeeds**

Run: `pnpm --filter site build`
Expected: build completes without CSS errors. Look for any `tailwindcss` parse errors in the output — there should be none.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/styles/root.css
git commit -m "feat(site): add shadow-card Tailwind utility for hero shader cards"
```

---

## Task 2: Create the `HeroShader` component

**Files:**
- Create: `apps/site/src/components/HeroShader.tsx`
- Create: `apps/site/src/components/__tests__/HeroShader.test.tsx`

The component renders one of three things in its single absolutely-positioned wrapper: a `<canvas>` driven by WebGL2 (the happy path), or a CSS-gradient `<div>` (fallback). A fade-overlay `<div>` is always rendered on top of either, masking the shader gradually into white.

happy-dom has no WebGL2, so `canvas.getContext('webgl2')` returns `null` and the effect switches to the fallback DOM. The tests exercise the fallback + cleanup paths; the GL path can only be verified in a real browser (Task 4).

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/components/__tests__/HeroShader.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { HeroShader } from '../HeroShader.js';

afterEach(() => cleanup());

describe('HeroShader', () => {
  it('renders an aria-hidden background wrapper', () => {
    const { container } = render(<HeroShader />);
    const wrapper = container.querySelector('[aria-hidden="true"]');
    expect(wrapper).not.toBeNull();
  });

  it('renders a canvas element on initial mount', () => {
    const { container } = render(<HeroShader />);
    // Initial SSR/first-render path renders the canvas; the effect may swap to a
    // fallback div after mount if WebGL2 isn't available.
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('unmounts cleanly without throwing', () => {
    const { unmount } = render(<HeroShader />);
    expect(() => unmount()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test apps/site/src/components/__tests__/HeroShader.test.tsx`
Expected: FAIL with "Cannot find module '../HeroShader.js'" or equivalent.

- [ ] **Step 3: Implement `HeroShader.tsx`**

Create `apps/site/src/components/HeroShader.tsx`:

```tsx
import { useEffect, useRef, useState } from 'preact/hooks';

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
out vec4 outColor;
void main() {
  vec2 uv = (gl_FragCoord.xy / u_res.xy - 0.5);
  uv.x *= u_res.x / u_res.y;
  float t = u_time * 0.25;
  float v = sin(uv.x * 3.0 + t)
          + sin((uv.y + t) * 4.0)
          + sin((uv.x + uv.y) * 3.0 + t * 1.2)
          + sin(length(uv) * 6.0 - t * 1.5);
  v *= 0.25;
  vec3 A = vec3(1.00, 0.95, 0.93);
  vec3 B = vec3(1.00, 0.62, 0.43);
  vec3 C = vec3(0.79, 0.49, 1.00);
  vec3 col = mix(A, B, 0.5 + 0.5 * v);
  col = mix(col, C, 0.25 * sin(v * 3.1415));
  outColor = vec4(col, 1.0);
}`;

const FADE_GRADIENT =
  'linear-gradient(to bottom,' +
  ' rgba(255,255,255,0) 0%,' +
  ' rgba(255,255,255,0) 30%,' +
  ' rgba(255,255,255,0.35) 55%,' +
  ' rgba(255,255,255,0.75) 80%,' +
  ' rgba(255,255,255,1) 100%)';

const FALLBACK_GRADIENT =
  'linear-gradient(135deg, #FFF1ED 0%, #FF9F6E 50%, #C97DFF 100%)';

export function HeroShader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;

    if (!gl) {
      setFallback(true);
      return;
    }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        // Surface to console but do not throw; fall back instead.
        console.error('HeroShader compile error:', gl.getShaderInfoLog(s));
      }
      return s;
    };

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('HeroShader link error:', gl.getProgramInfoLog(prog));
      setFallback(true);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const t0 = performance.now();
    let rafId = 0;
    let paused = false;

    const drawFrame = () => {
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const loop = () => {
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };

    if (reduceMotion) {
      drawFrame();
    } else {
      rafId = requestAnimationFrame(loop);
    }

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        paused = true;
      } else if (paused && !reduceMotion) {
        paused = false;
        rafId = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div class="absolute inset-0 -z-10 pointer-events-none" aria-hidden="true">
      {fallback ? (
        <div
          class="absolute inset-0"
          style={{ background: FALLBACK_GRADIENT }}
        />
      ) : (
        <canvas ref={canvasRef} class="absolute inset-0 block w-full h-full" />
      )}
      <div class="absolute inset-0" style={{ background: FADE_GRADIENT }} />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test apps/site/src/components/__tests__/HeroShader.test.tsx`
Expected: all three tests PASS. The third test exercises the cleanup path; if cancel/removeEventListener throws, this catches it.

- [ ] **Step 5: Type-check**

Run: `pnpm typecheck`
Expected: no errors. If TypeScript complains about `WebGL2RenderingContext` (it shouldn't, it's in `lib.dom.d.ts`), confirm `apps/site/tsconfig.json` includes the `DOM` lib.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/HeroShader.tsx apps/site/src/components/__tests__/HeroShader.test.tsx
git commit -m "feat(site): add HeroShader component with WebGL2 plasma and CSS fallback"
```

---

## Task 3: Wire `HeroShader` into the homepage and shadow the content cards

**Files:**
- Modify: `apps/site/src/pages/home.tsx`
- Modify: `apps/site/src/pages/__tests__/home.test.tsx`

The shader sits behind the existing `<main>`. We turn the page's outermost element into a positioned container, prepend `<HeroShader />`, and ensure `<main>` is in front via `relative`. The local `Card` and `CodeBlock` components swap their `border` look for the lifted-card look using `shadow-card`.

- [ ] **Step 1: Add a failing test that asserts the shader is mounted**

In `apps/site/src/pages/__tests__/home.test.tsx`, add this test inside the existing `describe('home (marketing landing)', ...)` block (after the last `it(...)`, before the closing `});`):

```tsx
  it('mounts the hero shader background', () => {
    const { container } = render(<Home />);
    // HeroShader renders an aria-hidden wrapper containing a canvas (or the
    // CSS fallback) plus a fade overlay.
    const bg = container.querySelector('[aria-hidden="true"]');
    expect(bg).not.toBeNull();
    expect(bg!.querySelector('canvas')).not.toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test apps/site/src/pages/__tests__/home.test.tsx`
Expected: the new test FAILS (`bg` is `null`), the other four still PASS.

- [ ] **Step 3: Update `home.tsx`**

Replace the contents of `apps/site/src/pages/home.tsx` with:

```tsx
import type { FunctionComponent } from 'preact';
import { useMeta, useTitle } from 'hoofd/preact';
import { HeroShader } from '../components/HeroShader.js';

const Home: FunctionComponent = () => {
  useTitle('hono-preact');
  useMeta({
    name: 'description',
    content:
      'Hono on the edge, Preact in the browser, manifest driven routes, typed RPC, streaming everywhere.',
  });
  return (
    <div class="relative isolate overflow-hidden">
      <HeroShader />
      <main class="relative mx-auto max-w-4xl px-6 py-16 space-y-16">
        {/* Hero */}
        <section class="space-y-4 text-center">
          <p class="inline-block bg-white/70 backdrop-blur text-xs px-2 py-0.5 rounded-full border border-black/5">
            hono-preact v0.2
          </p>
          <h1 class="text-5xl font-semibold">A small full-stack framework.</h1>
          <p class="text-lg text-gray-700 max-w-2xl mx-auto">
            Hono on the edge, Preact in the browser, manifest driven routes, typed
            RPC, streaming everywhere.
          </p>
          <div class="flex gap-3 justify-center pt-2">
            <a
              href="/docs/quick-start"
              class="bg-blue-600 text-white px-4 py-2 font-medium rounded-md"
            >
              Get started
            </a>
            <a
              href="/demo"
              class="border border-gray-700 text-gray-900 px-4 py-2 font-medium rounded-md bg-white/80 backdrop-blur"
            >
              See the demo
            </a>
          </div>
        </section>

        {/* Code block */}
        <section class="space-y-4">
          <h2 class="text-sm uppercase tracking-wide text-gray-600">
            Keep it simple
          </h2>
          <div class="grid gap-3 md:grid-cols-2">
            <CodeBlock filename="vite.config.ts">
              {`import { defineApp } from 'hono-preact/vite';
export default defineApp();`}
            </CodeBlock>
            <CodeBlock filename="src/routes.ts">
              {`import { defineRoutes } from 'hono-preact';
export default defineRoutes([
  { path: '/', view: () => import('./views/home') },
]);`}
            </CodeBlock>
            <CodeBlock filename="src/views/home.tsx">
              {`export default function Home() {
  return <h1>Hello</h1>;
}`}
            </CodeBlock>
            <CodeBlock filename="src/Layout.tsx">
              {`import { ClientScript, Head } from 'hono-preact';
export default function Layout({ children }) {
  return (
    <html>
      <Head defaultTitle="hono-preact" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}`}
            </CodeBlock>
          </div>
        </section>

        {/* Feature cards */}
        <section class="grid gap-4 md:grid-cols-2">
          <Card title="Manifest-driven routes">
            Your routes are a data structure, not a directory tree.
          </Card>
          <Card title="Typed RPC, end to end">
            Loaders and actions are typed functions; the client gets a typed stub.
          </Card>
          <Card title="Streaming everywhere">
            Loaders, forms, SSE. Built on ReadableStream.
          </Card>
          <Card title="One package">
            <code>hono-preact</code>, <code>hono-preact/server</code>,{' '}
            <code>hono-preact/vite</code>. Nothing else to install.
          </Card>
        </section>

        {/* Footer */}
        <footer class="pt-8 border-t text-sm text-gray-700 flex flex-wrap gap-4 justify-between">
          <span>
            <a class="underline" href="https://github.com/sbesh91/hono-preact">
              GitHub
            </a>{' '}
            ·{' '}
            <a class="underline" href="https://www.npmjs.com/package/hono-preact">
              npm
            </a>
          </span>
          <span>MIT</span>
        </footer>
      </main>
    </div>
  );
};
Home.displayName = 'Home';

const CodeBlock: FunctionComponent<{
  filename: string;
  children: string;
}> = ({ filename, children }) => (
  <figure class="rounded-md border border-black/5 bg-white shadow-card overflow-hidden">
    <figcaption class="text-xs text-gray-600 px-3 py-1 border-b border-black/5 bg-gray-50">
      {filename}
    </figcaption>
    <pre class="text-xs p-3 overflow-x-auto">
      <code>{children}</code>
    </pre>
  </figure>
);

const Card: FunctionComponent<{ title: string; children: any }> = ({
  title,
  children,
}) => (
  <article class="rounded-md border border-black/5 bg-white shadow-card p-4">
    <h3 class="font-semibold mb-1">{title}</h3>
    <p class="text-sm text-gray-700">{children}</p>
  </article>
);

export default Home;
```

Key differences from the original `home.tsx`:

- New outer `<div class="relative isolate overflow-hidden">` wraps everything; the page is the stacking context.
- `<HeroShader />` is the first child of that wrapper.
- `<main>` gets `relative` so it sits above the shader on the z-axis.
- The pill and the secondary CTA get translucent backgrounds (`bg-white/70 backdrop-blur` and `bg-white/80 backdrop-blur`) so the shader shows through legibly.
- `CodeBlock` and `Card` use `rounded-md border border-black/5 bg-white shadow-card` instead of the old plain `border`.
- Primary CTA gets `rounded-md` to match the new card look.

- [ ] **Step 4: Run the tests to verify they all pass**

Run: `pnpm test apps/site/src/pages/__tests__/home.test.tsx apps/site/src/components/__tests__/HeroShader.test.tsx`
Expected: all tests (the four original `home` tests, the new `mounts the hero shader background` test, and the three `HeroShader` tests) PASS.

- [ ] **Step 5: Full type-check and lint**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/home.tsx apps/site/src/pages/__tests__/home.test.tsx
git commit -m "feat(site): wire HeroShader into homepage and shadow content cards"
```

---

## Task 4: Manual verification in the browser

**Files:** none (verification only).

The unit tests cover the fallback path. The actual WebGL render, the fade, the shadows, the reduced-motion handling, and the visibility pause can only be confirmed by hand.

- [ ] **Step 1: Start the dev server**

Run: `pnpm --filter site dev`
Expected: Vite starts and prints a local URL (typically `http://localhost:5173`).

- [ ] **Step 2: Confirm the shader appears behind the hero**

Open the printed URL. Expected:

- A warm peach/coral/violet gradient is animating behind the hero.
- The "hono-preact v0.2" pill, headline, sub, and "Get started" / "See the demo" CTAs are clearly legible.
- The shader fades into white roughly through the upper "Keep it simple" code samples and is gone by the feature cards.
- All four `CodeBlock` figures and all four `Card` blocks show a soft drop shadow and rounded corners.
- No console errors.

- [ ] **Step 3: Verify the reduced-motion path**

In Chrome DevTools, open the Command Palette (Cmd+Shift+P), run `Emulation: prefers-reduced-motion: reduce`, then reload the page.
Expected: the gradient is still warm and visible, but is now static (no animation). Toggle back to "No preference" and reload to confirm motion resumes.

- [ ] **Step 4: Verify the tab-visibility pause**

Open DevTools → Performance Monitor (More tools → Performance monitor). Note the "CPU usage" baseline with the homepage focused. Switch to another tab for ~5 seconds, switch back. Expected: CPU drops noticeably while the tab is hidden, and resumes when refocused.

- [ ] **Step 5: Verify the WebGL2 fallback**

In Chrome DevTools, open the Command Palette, run `Rendering: Disable WebGL`, then reload the page. Expected: instead of the animated shader, the same area shows a static diagonal `135deg` peach→coral→violet gradient; the fade overlay still applies; the page otherwise behaves identically. Re-enable WebGL and reload to restore the animation.

- [ ] **Step 6: Quick Lighthouse check (optional but recommended)**

Run a Lighthouse audit on the homepage in a fresh incognito window. Expected: Performance score does not drop by more than ~5 points from the pre-change baseline. If it does, profile where time is going (likely DPR or shader cost) before merging.

- [ ] **Step 7: Stop the dev server**

Ctrl+C the dev server.

- [ ] **Step 8: Final commit (only if any tweaks were needed)**

If steps 2–6 surfaced any minor visual tweaks (e.g., card shadow too strong, fade too aggressive), make the change and commit:

```bash
git add -A
git commit -m "fix(site): tune HeroShader visuals after manual verification"
```

Otherwise skip this step.

---

## Self-review notes

- All four spec sections (Visual specification, Behavior, Component architecture, Testing) map to tasks: visual spec → Task 2 + Task 3; behavior (reduced-motion, visibility pause, DPR cap, fallback, SSR) → Task 2; component architecture → Task 2 + Task 3; testing → Tasks 2/3 unit tests + Task 4 manual.
- The non-goals (dark mode, scroll-pause via IntersectionObserver, mouse-reactive shader, shader on docs pages) are not implemented anywhere — confirmed by re-reading each task.
- No placeholder text remains.
- Type/property/method names used across tasks are consistent: `HeroShader` (component name), `shadow-card` (utility), `aria-hidden="true"` wrapper (queried in tests), `canvas` (queried in tests), all match between Tasks 2 and 3.
