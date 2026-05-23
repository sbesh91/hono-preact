# Homepage hero shader background

## Summary

Add an animated WebGL plasma shader as a background to the `apps/site` homepage. The shader covers the full viewport behind the hero, fades gradually into solid white roughly two-thirds of the way down the page, and content blocks (code samples, feature cards) gain soft shadows so they lift off the gradient.

Scope is the marketing homepage only (`apps/site/src/pages/home.tsx`). Docs pages and the rest of the site are unaffected.

## Visual specification

**Shader**

A four-term sine-field plasma, sampled in normalized device coords:

```glsl
v = sin(uv.x*3.0 + t)
  + sin((uv.y + t)*4.0)
  + sin((uv.x + uv.y)*3.0 + t*1.2)
  + sin(length(uv)*6.0 - t*1.5);
v *= 0.25;
```

`t = u_time * 0.25` (slow motion). `uv` is `gl_FragCoord.xy / u_res - 0.5` with aspect correction on `uv.x`.

**Palette (warm sunset)**

| Role | sRGB | Linear (vec3) |
|---|---|---|
| Base  | `#FFF1ED` | `vec3(1.00, 0.95, 0.93)` |
| Mid   | `#FF9F6E` | `vec3(1.00, 0.62, 0.43)` |
| Accent| `#C97DFF` | `vec3(0.79, 0.49, 1.00)` |

Final color: `mix(Base, Mid, 0.5 + 0.5*v)` then `mix(col, Accent, 0.25*sin(v*PI))`.

**Coverage and fade**

One full-bleed canvas behind the homepage. A sibling overlay applies the fade:

```css
background: linear-gradient(
  to bottom,
  rgba(255,255,255,0)   0%,
  rgba(255,255,255,0)  30%,
  rgba(255,255,255,0.35) 55%,
  rgba(255,255,255,0.75) 80%,
  rgba(255,255,255,1)  100%
);
```

The shader is fully visible behind the hero, dissolves gradually through the upper code-sample row, and is gone by the feature cards.

**Content shadows**

All content blocks on the homepage (`CodeBlock` figures, feature `Card`s) get:

```css
box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 6px 16px rgba(16,24,40,0.08);
border: 1px solid rgba(0,0,0,0.05);
border-radius: 6px;
background: #fff;
```

The current 1px gray border is replaced by the lifted-card look.

## Behavior

- **Rendering** uses raw WebGL2 with a single fullscreen-quad fragment shader. No Three.js, no `regl`. The shader source is small enough to live inline in the component.
- **Reduced motion**: when `matchMedia('(prefers-reduced-motion: reduce)').matches`, render exactly one frame and do not request further animation frames. The static frame still uses the warm palette.
- **Tab visibility**: pause the `requestAnimationFrame` loop on `visibilitychange` when the document is hidden; resume when visible. Avoids burning GPU in background tabs.
- **DPR cap**: device pixel ratio is clamped to `2` for the backing-store resolution.
- **Fallback**: if `getContext('webgl2')` returns null, render a static CSS linear-gradient with the same three palette stops, no canvas. Page composition is unchanged.
- **SSR**: the component renders the fade overlay and a placeholder element during SSR. The canvas + WebGL bootstrap runs only on the client (inside `useEffect`).

## Component architecture

New file `apps/site/src/components/HeroShader.tsx` exporting a single component:

```tsx
<HeroShader />
```

Responsibilities:

1. Render `<canvas>` (absolute-positioned, `inset: 0`, `pointer-events: none`, behind content).
2. Render the fade overlay `<div>` directly after the canvas, same positioning, same `pointer-events: none`.
3. On mount, attempt WebGL2 bootstrap; if it fails, swap the canvas for the CSS gradient fallback.
4. Manage the rAF loop, visibility handler, and reduced-motion check.
5. Clean up rAF + listeners on unmount.

The component does not own page layout; it returns a fragment that the page sticks into a positioned ancestor.

## `home.tsx` changes

- Wrap the existing `<main>` content in a positioned container so the shader can sit behind it:
  - The container is the new top-level element of the page; it gets `position: relative`.
  - `<HeroShader />` is the first child.
  - Existing `<main>` becomes the second child with `position: relative` so it stacks above the canvas.
- Update the inline `Card` and `CodeBlock` component classes:
  - `Card`: replace `border` with `border border-black/5 rounded-md shadow-card bg-white`.
  - `CodeBlock` figure: same shadow treatment, keep the inner header divider.
- Pill, title, sub, and CTA remain unchanged.

The site uses Tailwind v4 (no config file, `@import 'tailwindcss'` in `root.css`). Add the shadow as a custom utility in `root.css`:

```css
@utility shadow-card {
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 16px rgba(16, 24, 40, 0.08);
}
```

`Card` and `CodeBlock` then use `shadow-card` alongside `border-black/5 rounded-md bg-white`.

## Files affected

- New: `apps/site/src/components/HeroShader.tsx`
- Modified: `apps/site/src/pages/home.tsx`
- Modified (maybe): `apps/site/src/styles/root.css` or Tailwind config, for `shadow-card`

No other apps or packages are touched.

## Testing

- Unit/render: no snapshot tests for the shader itself. Add one render test that mounts `<HeroShader />` in jsdom and verifies it does not throw and emits the fade overlay element (canvas will fail to get a WebGL2 context in jsdom, which exercises the fallback path).
- Manual:
  - Homepage renders with the plasma visible behind the hero.
  - Scrolling down: shader has fully dissolved by the feature cards.
  - `prefers-reduced-motion: reduce` (System Settings → Accessibility on macOS, or DevTools emulation): shader is present but static.
  - Hide the tab; CPU/GPU activity drops; show the tab again, animation resumes.
  - Older browser without WebGL2 (or DevTools-forced failure): fallback gradient appears, page still works.
  - Lighthouse performance on the homepage stays in the same band as before (target: no regression > 5 points).

## Non-goals

- Applying the shader to docs pages or the layout shell.
- Dark-mode variant of the palette (the site is currently light-mode only).
- Mouse/scroll-reactive shader parameters.
- Pausing the loop when the hero scrolls out of view via IntersectionObserver. (Visibility-based pausing is enough; if profiling later shows the cost still matters, we can add scroll-based pausing then.)
- Customizing the shader per-route or via props. The homepage gets one configuration.
