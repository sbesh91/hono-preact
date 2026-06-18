# Demo + Code tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the real source powering each component-page demo in a Demo | Code tab, built on one small accessible docs `Tabs` primitive that also replaces the bespoke tab logic in `CodeTabs`.

**Architecture:** A build-time Vite plugin highlights demo source via a `?highlighted` import query, reusing one shared Shiki config (so demo source renders identically to MDX fences, zero client-side highlighter). A generic `Tabs` docs component owns tab switching + ARIA; `CodeTabs` and an enriched `Example` (gains an optional `code` prop) both compose it. Component pages pass the highlighted source to `<Example code={...}>` and drop their hand-written `## Usage` fence.

**Tech Stack:** Preact (`^10.29.1`, `useId` available), Vite, `@shikijs/rehype` / `shiki` (4.x), MDX (`@mdx-js/rollup`), Vitest + `@testing-library/preact` (happy-dom).

**Spec:** `docs/superpowers/specs/2026-06-17-demo-code-tabs-design.md`

---

## File structure

Created:
- `apps/site/src/shiki/shiki-config.ts`: single source of the dual-theme Shiki config (themes, defaultColor, langs) consumed by both the MDX rehype plugin and the highlight plugin.
- `apps/site/src/shiki/highlight.ts`: `highlightCode(code, lang)`: a cached singleton Shiki highlighter that returns highlighted HTML. Pure and unit-testable.
- `apps/site/src/shiki/vite-plugin-highlight.ts`: Vite plugin resolving `*?highlighted` imports to highlighted-HTML string modules.
- `apps/site/src/shiki/__tests__/highlight.test.ts`: tests `highlightCode` and the plugin's `load`.
- `apps/site/src/shiki/__tests__/fixtures/sample.tsx`: fixture for the plugin test.
- `apps/site/src/highlighted.d.ts`: ambient `declare module '*?highlighted'`.
- `apps/site/src/components/docs/Tabs.tsx`: generic tab primitive (tablist + ARIA + roving + show/hide).
- `apps/site/src/components/docs/__tests__/Tabs.test.tsx`: `Tabs` a11y tests.
- `apps/site/src/components/docs/<Name>Example.tsx`: clean core files for explorer demos (e.g. `TooltipExample.tsx`).
- `apps/site/src/pages/docs/__tests__/example-code-gate.test.ts`: gate: every `<Example>` under `docs/components/**` passes `code`.

Modified:
- `apps/site/vite.config.ts`: use `shiki-config`; register the highlight plugin.
- `apps/site/package.json`: add `shiki` devDependency (4.x).
- `apps/site/src/components/docs/CodeTabs.tsx`: refactor onto `Tabs`.
- `apps/site/src/components/docs/Example.tsx`: add `code` prop + Demo|Code rendering.
- `apps/site/src/components/docs/__tests__/CodeTabs.test.tsx`: update for render-all-panels model + Example code prop.
- `apps/site/src/styles/root.css`: rename `docs-codetabs` part classes to shared `docs-tabs`; add tabbed-demo panel styling.
- `apps/site/src/pages/docs/components/*.mdx`: convert each demo to Demo|Code, delete `## Usage` fence.
- `apps/site/src/components/docs/<Name>Demo.tsx`: for explorer demos, become a harness around the new core file.

---

## Task 1: Extract the shared Shiki config

**Files:**
- Create: `apps/site/src/shiki/shiki-config.ts`
- Modify: `apps/site/vite.config.ts:20-35` (the `mdxOptions` block) and the `rehypeShiki` usage

- [ ] **Step 1: Create the shared config**

`apps/site/src/shiki/shiki-config.ts`:

```ts
// Single source of truth for Shiki highlighting on the docs site. Consumed by
// the MDX rehype plugin (fenced code blocks) and by the build-time highlight
// plugin (demo source shown in Code tabs), so both render identically and the
// dark-mode swap in root.css (.shiki / [data-theme='dark']) works for both.
export const SHIKI_THEMES = {
  light: 'github-light',
  dark: 'github-dark',
} as const;

export const SHIKI_DEFAULT_COLOR = 'light';

export const SHIKI_LANGS = ['ts', 'tsx', 'bash', 'jsonc', 'mdx', 'css'] as const;

// Options object in the exact shape `@shikijs/rehype` expects.
export const rehypeShikiOptions = {
  themes: SHIKI_THEMES,
  defaultColor: SHIKI_DEFAULT_COLOR,
  langs: [...SHIKI_LANGS],
};
```

- [ ] **Step 2: Use it in `vite.config.ts`**

Add to the imports near the top (after the existing `rehypeShiki` import on line 5):

```ts
import { rehypeShikiOptions } from './src/shiki/shiki-config.js';
```

Replace the inline rehype options object (lines 24-33) so the `rehypePlugins` entry reads:

```ts
  rehypePlugins: [
    [
      rehypeShiki,
      // Dual theme: light is the inline default; root.css switches to the dark
      // theme's colors in dark mode. Shared with the demo-source highlighter.
      rehypeShikiOptions,
    ],
  ],
```

- [ ] **Step 3: Verify fenced highlighting still works**

Run: `pnpm --filter site build`
Expected: build succeeds. (This is a pure refactor; the build is the check. A failure here means the import path or option shape is wrong.)

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/shiki/shiki-config.ts apps/site/vite.config.ts
git commit -m "refactor(site): extract shared Shiki config"
```

---

## Task 2: `highlightCode` + the `shiki` dependency

**Files:**
- Modify: `apps/site/package.json`
- Create: `apps/site/src/shiki/highlight.ts`
- Test: `apps/site/src/shiki/__tests__/highlight.test.ts`

- [ ] **Step 1: Add `shiki` as a devDependency (match `@shikijs/rehype` major)**

`@shikijs/rehype` is `^4.0.2`, so `shiki` must be `^4`.

Run: `pnpm --filter site add -D shiki@^4`
Expected: `shiki` appears in `apps/site/package.json` devDependencies at `^4.x`.

- [ ] **Step 2: Write the failing test**

`apps/site/src/shiki/__tests__/highlight.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { highlightCode } from '../highlight.js';

describe('highlightCode', () => {
  it('returns Shiki HTML for tsx source', async () => {
    const html = await highlightCode('const answer: number = 42;', 'tsx');
    expect(html).toContain('class="shiki');
    expect(html).toContain('<pre');
    // The identifier survives as text inside the highlighted markup.
    expect(html).toContain('answer');
  });

  it('emits the dual-theme CSS variables (light + dark)', async () => {
    const html = await highlightCode('const x = 1;', 'tsx');
    // defaultColor: 'light' inlines color:; the dark theme is carried as a
    // --shiki-dark custom property that root.css promotes in dark mode.
    expect(html).toContain('--shiki-dark');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter site exec vitest run src/shiki/__tests__/highlight.test.ts`
Expected: FAIL with a module-not-found error for `../highlight.js`.

- [ ] **Step 4: Implement `highlightCode`**

`apps/site/src/shiki/highlight.ts`:

```ts
import { createHighlighter, type Highlighter } from 'shiki';
import {
  SHIKI_THEMES,
  SHIKI_DEFAULT_COLOR,
  SHIKI_LANGS,
} from './shiki-config.js';

// Lazily create one highlighter and reuse it across files (creating one per
// call is slow). The promise is cached so concurrent callers share the instance.
let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: Object.values(SHIKI_THEMES),
      langs: [...SHIKI_LANGS],
    });
  }
  return highlighterPromise;
}

// Highlight a code string to HTML using the shared dual-theme config, so the
// output matches the site's fenced code blocks exactly.
export async function highlightCode(
  code: string,
  lang: string
): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang,
    themes: SHIKI_THEMES,
    defaultColor: SHIKI_DEFAULT_COLOR,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter site exec vitest run src/shiki/__tests__/highlight.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add apps/site/package.json apps/site/src/shiki/highlight.ts apps/site/src/shiki/__tests__/highlight.test.ts
git commit -m "feat(site): add build-time Shiki highlightCode helper"
```

(If the workspace lockfile changed, include `pnpm-lock.yaml` in the commit.)

---

## Task 3: The `?highlighted` Vite plugin + ambient types

**Files:**
- Create: `apps/site/src/shiki/vite-plugin-highlight.ts`
- Create: `apps/site/src/highlighted.d.ts`
- Create: `apps/site/src/shiki/__tests__/fixtures/sample.tsx`
- Modify: `apps/site/src/shiki/__tests__/highlight.test.ts` (add plugin `load` test)
- Modify: `apps/site/vite.config.ts` (register plugin)

- [ ] **Step 1: Create the fixture**

`apps/site/src/shiki/__tests__/fixtures/sample.tsx`:

```tsx
export function Sample() {
  return <span>hi</span>;
}
```

- [ ] **Step 2: Write the failing plugin test (append to `highlight.test.ts`)**

Add to `apps/site/src/shiki/__tests__/highlight.test.ts`:

```ts
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { highlightPlugin } from '../vite-plugin-highlight.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, 'fixtures/sample.tsx');

describe('highlightPlugin', () => {
  it('ignores ids without the ?highlighted query', async () => {
    const plugin = highlightPlugin();
    const load = plugin.load as (id: string) => Promise<string | null>;
    expect(await load.call({ addWatchFile() {} }, fixture)).toBeNull();
  });

  it('loads a ?highlighted id as a default-exported HTML string', async () => {
    const plugin = highlightPlugin();
    const load = plugin.load as (id: string) => Promise<string | null>;
    const watched: string[] = [];
    const out = await load.call(
      { addWatchFile: (f: string) => watched.push(f) },
      `${fixture}?highlighted`
    );
    expect(out).toContain('export default');
    expect(out).toContain('class=\\"shiki'); // escaped inside the JSON string
    expect(watched).toContain(fixture);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter site exec vitest run src/shiki/__tests__/highlight.test.ts`
Expected: FAIL with a module-not-found error for `../vite-plugin-highlight.js`.

- [ ] **Step 4: Implement the plugin**

`apps/site/src/shiki/vite-plugin-highlight.ts`:

```ts
import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { highlightCode } from './highlight.js';

const QUERY = '?highlighted';

// Resolves `import html from './FooDemo.tsx?highlighted'` to the file's source,
// Shiki-highlighted at build time, exported as an HTML string. No runtime
// highlighter is shipped to the client.
export function highlightPlugin(): Plugin {
  return {
    name: 'docs-highlight',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(QUERY)) return null;
      const base = source.slice(0, -QUERY.length);
      const resolved = await this.resolve(base, importer, { skipSelf: true });
      return resolved ? resolved.id + QUERY : null;
    },
    async load(id) {
      if (!id.endsWith(QUERY)) return null;
      const file = id.slice(0, -QUERY.length);
      // Track the source so edits trigger HMR / rebuild (we read it directly
      // rather than importing it, so Vite would not otherwise watch it).
      this.addWatchFile(file);
      const code = await readFile(file, 'utf8');
      // Demo files are .tsx; fall back to the raw extension for anything else.
      const lang = file.split('.').pop() ?? 'txt';
      const html = await highlightCode(code, lang);
      return `export default ${JSON.stringify(html)};`;
    },
  };
}
```

- [ ] **Step 5: Create the ambient module type**

`apps/site/src/highlighted.d.ts`:

```ts
// `import html from './FooDemo.tsx?highlighted'` yields the file's Shiki-
// highlighted HTML as a string (produced by vite-plugin-highlight at build).
declare module '*?highlighted' {
  const html: string;
  export default html;
}
```

- [ ] **Step 6: Register the plugin in `vite.config.ts`**

Add the import near the top (after the `shiki-config` import from Task 1):

```ts
import { highlightPlugin } from './src/shiki/vite-plugin-highlight.js';
```

Add `highlightPlugin()` as the FIRST entry of the `plugins` array (line 113), so its `enforce: 'pre'` resolve/load run before the framework and MDX plugins:

```ts
  plugins: [
    highlightPlugin(),
    honoPreact({ adapter: cloudflareAdapter() }),
    // ...rest unchanged
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter site exec vitest run src/shiki/__tests__/highlight.test.ts`
Expected: PASS (all four tests).

Run: `pnpm --filter site exec tsc --noEmit` (or `pnpm typecheck`)
Expected: no errors (the ambient `*?highlighted` declaration resolves the import type).

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/shiki/vite-plugin-highlight.ts apps/site/src/highlighted.d.ts apps/site/src/shiki/__tests__/fixtures/sample.tsx apps/site/src/shiki/__tests__/highlight.test.ts apps/site/vite.config.ts
git commit -m "feat(site): highlight demo source via ?highlighted Vite plugin"
```

---

## Task 4: The generic `Tabs` primitive

**Files:**
- Create: `apps/site/src/components/docs/Tabs.tsx`
- Test: `apps/site/src/components/docs/__tests__/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/site/src/components/docs/__tests__/Tabs.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { Tabs } from '../Tabs.js';

afterEach(cleanup);

function panelFor(el: HTMLElement) {
  return el.closest('[role="tabpanel"]') as HTMLElement;
}

describe('Tabs', () => {
  function basic() {
    return (
      <Tabs labels={['One', 'Two']}>
        <p>first</p>
        <p>second</p>
      </Tabs>
    );
  }

  it('selects the first tab by default and renders all panels', () => {
    const { getByRole, getByText } = render(basic());
    expect(getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    // Both panels exist; the inactive one is hidden.
    expect(panelFor(getByText('first')).hidden).toBe(false);
    expect(panelFor(getByText('second')).hidden).toBe(true);
  });

  it('switches the active panel on click', () => {
    const { getByRole, getByText } = render(basic());
    fireEvent.click(getByRole('tab', { name: 'Two' }));
    expect(panelFor(getByText('first')).hidden).toBe(true);
    expect(panelFor(getByText('second')).hidden).toBe(false);
  });

  it('moves selection with ArrowRight/ArrowLeft and wraps', () => {
    const { getByRole } = render(basic());
    const tablist = getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    fireEvent.keyDown(tablist, { key: 'ArrowRight' }); // wraps to first
    expect(getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('links each tab to its panel via aria-controls', () => {
    const { getByRole, getByText } = render(basic());
    const tab = getByRole('tab', { name: 'One' });
    expect(tab.getAttribute('aria-controls')).toBe(panelFor(getByText('first')).id);
  });

  it('renders an accessory and passes it the active index', () => {
    const { getByText, getByRole } = render(
      <Tabs
        labels={['One', 'Two']}
        accessory={({ active }) => <span>active:{active}</span>}
      >
        <p>first</p>
        <p>second</p>
      </Tabs>
    );
    expect(getByText('active:0')).toBeTruthy();
    fireEvent.click(getByRole('tab', { name: 'Two' }));
    expect(getByText('active:1')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter site exec vitest run src/components/docs/__tests__/Tabs.test.tsx`
Expected: FAIL with module-not-found for `../Tabs.js`.

- [ ] **Step 3: Implement `Tabs`**

`apps/site/src/components/docs/Tabs.tsx`:

```tsx
import { toChildArray, type ComponentChildren, type VNode } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';

// Arg passed to the optional tablist accessory (e.g. a copy button) so it can
// react to which panel is showing and read its text.
export interface TabsAccessoryArgs {
  active: number;
  getActiveText: () => string;
}

interface TabsProps {
  // One label per panel, in order.
  labels: string[];
  // The panels, one per label (in docs these are fenced code blocks or demos).
  children: ComponentChildren;
  // Rendered at the end of the tablist.
  accessory?: (args: TabsAccessoryArgs) => ComponentChildren;
  // Class on the outer container (callers supply card styling).
  class?: string;
}

// Accessible tab strip: roving tabindex, arrow/Home/End navigation, and all
// panels rendered with inactive ones hidden (so SSR content is present and the
// active panel never remounts on switch). The shared primitive behind CodeTabs
// and the Demo|Code tabs in Example.
export function Tabs({ labels, children, accessory, class: className }: TabsProps) {
  const panels = toChildArray(children).filter(
    (c): c is VNode => typeof c === 'object'
  );
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  const getActiveText = () => panelRefs.current[active]?.textContent ?? '';

  const onKeyDown = (e: KeyboardEvent) => {
    const last = labels.length - 1;
    let next = active;
    if (e.key === 'ArrowRight') next = active === last ? 0 : active + 1;
    else if (e.key === 'ArrowLeft') next = active === 0 ? last : active - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div class={className}>
      <div class="docs-tabs__tablist" role="tablist" onKeyDown={onKeyDown}>
        {labels.map((label, i) => (
          <button
            key={label}
            ref={(el) => (tabRefs.current[i] = el)}
            type="button"
            role="tab"
            id={`${baseId}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            class="docs-tabs__tab"
            onClick={() => setActive(i)}
          >
            {label}
          </button>
        ))}
        {accessory?.({ active, getActiveText })}
      </div>
      {panels.map((panel, i) => (
        <div
          key={i}
          ref={(el) => (panelRefs.current[i] = el)}
          role="tabpanel"
          id={`${baseId}-panel-${i}`}
          aria-labelledby={`${baseId}-tab-${i}`}
          hidden={i !== active}
          class="docs-tabs__panel"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter site exec vitest run src/components/docs/__tests__/Tabs.test.tsx`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/docs/Tabs.tsx apps/site/src/components/docs/__tests__/Tabs.test.tsx
git commit -m "feat(site): add accessible Tabs docs primitive"
```

---

## Task 5: Refactor `CodeTabs` onto `Tabs` + rename CSS prefix

This is one atomic commit: the emitted part classes change from `docs-codetabs__*` to `docs-tabs__*`, so the CSS rename must land with the refactor.

**Files:**
- Modify: `apps/site/src/components/docs/CodeTabs.tsx`
- Modify: `apps/site/src/styles/root.css`
- Modify: `apps/site/src/components/docs/__tests__/CodeTabs.test.tsx`

- [ ] **Step 1: Update the `CodeTabs` test for the new model**

In `apps/site/src/components/docs/__tests__/CodeTabs.test.tsx`, replace the first `CodeTabs` test (lines 33-44) so it expects all panels rendered with inactive ones hidden:

```tsx
  it('shows the first block by default and switches on click', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    const { getByRole, getByText } = render(tabs());
    const cssPanel = getByText('css-code').closest('[role="tabpanel"]') as HTMLElement;
    const twPanel = getByText('tailwind-code').closest(
      '[role="tabpanel"]'
    ) as HTMLElement;
    expect(cssPanel.hidden).toBe(false);
    expect(twPanel.hidden).toBe(true);

    fireEvent.click(getByRole('tab', { name: 'Tailwind' }));
    expect(cssPanel.hidden).toBe(true);
    expect(twPanel.hidden).toBe(false);
  });
```

The copy test (lines 46-55) stays as-is: copy reads the active panel's text, which is still `css-code` by default.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter site exec vitest run src/components/docs/__tests__/CodeTabs.test.tsx`
Expected: FAIL (current `CodeTabs` destroys the inactive panel, so `getByText('tailwind-code')` throws / the new assertions fail).

- [ ] **Step 3: Refactor `CodeTabs` onto `Tabs`**

Replace the entire body of `apps/site/src/components/docs/CodeTabs.tsx`:

```tsx
import type { ComponentChildren } from 'preact';
import { Tabs } from './Tabs.js';
import { CopyButton } from './CopyButton.js';

interface CodeTabsProps {
  // One label per child code block, in order. The children are fenced code
  // blocks (```css, ```tsx, ...) so they are syntax-highlighted at build time
  // by the same Shiki pipeline as every other code sample on the docs site.
  labels: string[];
  children: ComponentChildren;
}

// Tabbed, copyable code examples. Built on the shared Tabs primitive; copies
// the active block's text (read from the DOM, so it copies the raw source
// rather than the highlighting markup).
export function CodeTabs({ labels, children }: CodeTabsProps) {
  return (
    <Tabs
      class="docs-tabs"
      labels={labels}
      accessory={({ getActiveText }) => (
        <CopyButton class="docs-tabs__copy" getText={getActiveText} />
      )}
    >
      {children}
    </Tabs>
  );
}
```

- [ ] **Step 4: Rename the CSS prefix in `root.css`**

In `apps/site/src/styles/root.css`, rename every `docs-codetabs` to `docs-tabs`. The affected lines are: 314, 383, 730, 736, 744, 759, 762, 766, 784, 790.

Run this to do it precisely (verify the diff afterward):

```bash
cd apps/site && sed -i '' 's/docs-codetabs/docs-tabs/g' src/styles/root.css && cd ../..
git diff --stat apps/site/src/styles/root.css
```

Expected result: `.docs-tabs` (container, line 730), `.docs-tabs__tablist`, `.docs-tabs__tab`, `.docs-tabs__tab:hover`, `.docs-tabs__tab[aria-selected='true']`, `.docs-tabs__copy`, `.docs-tabs__copy:hover`, `.docs-tabs__panel pre` (lines 314 and 790), and the `@media` rule (line 383) all now read `docs-tabs`. There are no other `docs-codetabs` occurrences.

Confirm none remain:

```bash
rg -n "docs-codetabs" apps/site/src
```
Expected: no matches.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter site exec vitest run src/components/docs/__tests__/CodeTabs.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 6: Visual spot-check (manual)**

Run: `pnpm --filter site dev`, open a page with a `CodeTabs` (e.g. `/docs/components/tooltip` Styling section). Confirm: tabs switch, active underline shows, Copy works, light/dark both highlight. (Firefox MCP can confirm the DOM swap + console is clean; CSS appearance is a human check.)

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/components/docs/CodeTabs.tsx apps/site/src/styles/root.css apps/site/src/components/docs/__tests__/CodeTabs.test.tsx
git commit -m "refactor(site): build CodeTabs on shared Tabs primitive"
```

---

## Task 6: Enrich `Example` with the `code` prop

**Files:**
- Modify: `apps/site/src/components/docs/Example.tsx`
- Modify: `apps/site/src/styles/root.css` (add tabbed-demo panel styling)
- Test: `apps/site/src/components/docs/__tests__/CodeTabs.test.tsx` (the `Example` describe block)

- [ ] **Step 1: Write the failing tests (extend the `Example` describe block)**

In `apps/site/src/components/docs/__tests__/CodeTabs.test.tsx`, the existing `Example` block keeps its "bordered frame" test. Add:

```tsx
  it('renders Demo|Code tabs when code is provided', () => {
    const { getByRole, getByText } = render(
      <Example code={'<pre class="shiki">const a = 1;</pre>'}>
        <span>live-demo</span>
      </Example>
    );
    expect(getByRole('tab', { name: 'Demo' })).toBeTruthy();
    expect(getByRole('tab', { name: 'Code' })).toBeTruthy();
    // Demo active by default.
    const demoPanel = getByText('live-demo').closest(
      '[role="tabpanel"]'
    ) as HTMLElement;
    expect(demoPanel.hidden).toBe(false);
  });

  it('shows the Copy button only on the Code tab', () => {
    const { getByRole, queryByRole } = render(
      <Example code={'<pre class="shiki">const a = 1;</pre>'}>
        <span>live-demo</span>
      </Example>
    );
    expect(
      queryByRole('button', { name: 'Copy code to clipboard' })
    ).toBeNull();
    fireEvent.click(getByRole('tab', { name: 'Code' }));
    expect(
      getByRole('button', { name: 'Copy code to clipboard' })
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter site exec vitest run src/components/docs/__tests__/CodeTabs.test.tsx`
Expected: FAIL (`Example` has no `code` prop yet; no tabs rendered).

- [ ] **Step 3: Implement the enriched `Example`**

Replace `apps/site/src/components/docs/Example.tsx`:

```tsx
import type { ComponentChildren } from 'preact';
import { Tabs } from './Tabs.js';
import { CopyButton } from './CopyButton.js';

interface ExampleProps {
  children: ComponentChildren;
  // Build-time highlighted HTML of the source that powers this demo, imported
  // via `'./FooDemo.tsx?highlighted'`. When present, the demo is shown in a
  // Demo|Code tab strip; when absent, just the bordered demo frame.
  code?: string;
}

// Hosts a live component demo on a docs page. With `code`, shows Demo|Code tabs
// (the Code tab is the real source that renders the demo, so it cannot drift).
export function Example({ children, code }: ExampleProps) {
  if (code == null) {
    return <div class="docs-example">{children}</div>;
  }
  return (
    <Tabs
      class="docs-tabs docs-example-tabs"
      labels={['Demo', 'Code']}
      accessory={({ active, getActiveText }) =>
        // Copy applies to the Code panel only (index 1).
        active === 1 ? (
          <CopyButton class="docs-tabs__copy" getText={getActiveText} />
        ) : null
      }
    >
      <div class="docs-example-tabs__demo">{children}</div>
      <div
        class="docs-example-tabs__code"
        // Trusted: our own files, highlighted at build time.
        dangerouslySetInnerHTML={{ __html: code }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 4: Add the tabbed-demo panel CSS**

In `apps/site/src/styles/root.css`, immediately after the `.docs-example { ... }` block (ends at line 596), add:

```css
/* Demo panel inside the Demo|Code tab strip: same dotted interactive surface
   as .docs-example, but without the outer border/margin/radius (the .docs-tabs
   card already provides those). */
.docs-example-tabs__demo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  min-height: 9rem;
  padding: 2rem;
  background:
    radial-gradient(circle at 1px 1px, var(--border-color) 1px, transparent 0) 0
      0 / 16px 16px,
    var(--surface);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter site exec vitest run src/components/docs/__tests__/CodeTabs.test.tsx`
Expected: PASS (frame test + two new tests + the CodeTabs tests).

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/docs/Example.tsx apps/site/src/styles/root.css apps/site/src/components/docs/__tests__/CodeTabs.test.tsx
git commit -m "feat(site): Example renders Demo|Code tabs when given source"
```

---

## Task 7: Classify demos, then migrate WYSIWYG pages

The migration recipe is uniform; the only per-page judgment is WYSIWYG vs explorer. This task does classification (a review checkpoint) and migrates the WYSIWYG pages. Task 8 handles the explorers.

### Classification rule

Read each `*Demo.tsx` referenced by a `docs/components/*.mdx`. A demo is an **explorer** (needs the Task 8 split) if it contains controls whose sole purpose is to explore the component's options (e.g. side/align pickers) rather than being part of a minimal real usage. Otherwise it is **WYSIWYG**: the demo file is itself the clean sample.

- [ ] **Step 1: Produce and record the classification**

Run: `rg -l "<Example" apps/site/src/pages/docs/components` to get the page list. For each page's demo component, open the `*Demo.tsx` and classify. Known up front: `tooltip` (placement explorer) is an explorer. Write the WYSIWYG-vs-explorer list into the PR/commit description so the reviewer can sanity-check before the bulk edits.

### WYSIWYG migration recipe (apply per page)

For a page `docs/components/foo.mdx` whose demo is `FooDemo`:

1. At the top of the `.mdx`, next to the existing `import { FooDemo } from '../../../components/docs/FooDemo.js';`, add the highlighted-source import:
   ```tsx
   import fooCode from '../../../components/docs/FooDemo.tsx?highlighted';
   ```
2. Change the demo usage from `<Example><FooDemo /></Example>` to:
   ```tsx
   <Example code={fooCode}>
     <FooDemo />
   </Example>
   ```
3. Delete the hand-written `## Usage` section (its heading and the fenced block under it). The Code tab now carries that role.
4. If the `FooDemo.tsx` file carries scaffolding that is noise in a sample but is NOT an exploratory control (e.g. an unnecessary outer wrapper), tidy the file so it reads as a clean usage example. Keep only the `docs-*` classes that the page's `## Styling` section documents.

### Worked example: Popover (WYSIWYG)

Before (`apps/site/src/pages/docs/components/popover.mdx`):

```tsx
import { Example } from '../../../components/docs/Example.js';
import { PopoverDemo } from '../../../components/docs/PopoverDemo.js';
...
<Example>
  <PopoverDemo />
</Example>
...
## Usage

```tsx
// hand-written snippet
```
```

After:

```tsx
import { Example } from '../../../components/docs/Example.js';
import { PopoverDemo } from '../../../components/docs/PopoverDemo.js';
import popoverCode from '../../../components/docs/PopoverDemo.tsx?highlighted';
...
<Example code={popoverCode}>
  <PopoverDemo />
</Example>
```

(The `## Usage` heading and its fence are deleted.)

- [ ] **Step 2: Migrate each WYSIWYG page (one commit per page)**

For each WYSIWYG page, apply the recipe, then:

Run: `pnpm --filter site exec vitest run` and `pnpm --filter site build`
Expected: tests pass; build succeeds (the `?highlighted` import resolves and the page renders).

Commit per page:

```bash
git add apps/site/src/pages/docs/components/foo.mdx apps/site/src/components/docs/FooDemo.tsx
git commit -m "docs(site): add Code tab to foo demo"
```

- [ ] **Step 3: After all WYSIWYG pages, run the site build + format**

Run: `pnpm format && pnpm format:check`
Run: `pnpm --filter site build`
Expected: clean format; build succeeds.

---

## Task 8: Migrate explorer pages (core + harness split)

**Files (per explorer page `foo`):**
- Create: `apps/site/src/components/docs/FooExample.tsx` (the clean core, shown via `?highlighted`)
- Modify: `apps/site/src/components/docs/FooDemo.tsx` (becomes the harness rendering the core)
- Modify: `apps/site/src/pages/docs/components/foo.mdx`

### Recipe

1. Create `FooExample.tsx`: the clean, minimal usage of the component. If the explorer varies props (e.g. `side`/`align`), give the core those as props with sensible defaults so the harness can drive it and the shown sample stays a single source of truth.
2. Rewrite `FooDemo.tsx` to import `FooExample` and render it inside the explorer controls (the controls live only in the harness, which is not shown).
3. In `foo.mdx`, import `import fooCode from '../../../components/docs/FooExample.tsx?highlighted';` (note: the **Example** file, not the Demo), keep rendering `<FooDemo />` live, pass `code={fooCode}`, and delete the `## Usage` fence.

### Worked example: Tooltip

`apps/site/src/components/docs/TooltipExample.tsx` (new core; `side`/`align` are props so the harness drives them):

```tsx
import { Tooltip } from 'hono-preact-ui';

interface TooltipExampleProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function TooltipExample({ side = 'top', align = 'center' }: TooltipExampleProps) {
  return (
    <Tooltip.Root side={side} align={align}>
      <Tooltip.Trigger class="docs-tooltip-trigger">Hover me</Tooltip.Trigger>
      <Tooltip.Positioner class="docs-tooltip-positioner">
        <Tooltip.Popup class="docs-tooltip">
          <Tooltip.Arrow class="docs-tooltip__arrow" />
          Saved to your library
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}
```

`apps/site/src/components/docs/TooltipDemo.tsx` (rewritten harness; controls only, renders the core):

```tsx
import { useState } from 'preact/hooks';
import { TooltipExample } from './TooltipExample.js';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;

// Placement explorer harness around the TooltipExample core. The controls exist
// only here (the docs Code tab shows TooltipExample, the real usage). Styling is
// in root.css (.docs-tooltip* / .docs-placement*).
export function TooltipDemo() {
  const [side, setSide] = useState<(typeof SIDES)[number]>('top');
  const [align, setAlign] = useState<(typeof ALIGNS)[number]>('center');
  return (
    <div class="docs-placement">
      <div class="docs-placement__controls">
        <div class="docs-placement__group" role="group" aria-label="Side">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              class="docs-placement__option"
              data-active={s === side}
              onClick={() => setSide(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div class="docs-placement__group" role="group" aria-label="Align">
          {ALIGNS.map((a) => (
            <button
              key={a}
              type="button"
              class="docs-placement__option"
              data-active={a === align}
              onClick={() => setAlign(a)}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <div class="docs-placement__stage">
        <TooltipExample side={side} align={align} />
      </div>
    </div>
  );
}
```

`apps/site/src/pages/docs/components/tooltip.mdx` import + usage:

```tsx
import { Example } from '../../../components/docs/Example.js';
import { CodeTabs } from '../../../components/docs/CodeTabs.js';
import { TooltipDemo } from '../../../components/docs/TooltipDemo.js';
import tooltipCode from '../../../components/docs/TooltipExample.tsx?highlighted';
...
<Example code={tooltipCode}>
  <TooltipDemo />
</Example>
```

(Delete the `## Usage` heading and its fence.)

- [ ] **Step 1: For each explorer page, apply the recipe**

- [ ] **Step 2: Verify per page**

Run: `pnpm --filter site exec vitest run` and `pnpm --filter site build`
Expected: pass + build succeeds; the Code tab shows the core (no explorer buttons in the sample).

- [ ] **Step 3: Commit per page**

```bash
git add apps/site/src/components/docs/FooExample.tsx apps/site/src/components/docs/FooDemo.tsx apps/site/src/pages/docs/components/foo.mdx
git commit -m "docs(site): add Code tab to foo demo (core + harness)"
```

---

## Task 9: Add the doc gate

**Files:**
- Create: `apps/site/src/pages/docs/__tests__/example-code-gate.test.ts`

- [ ] **Step 1: Write the gate test**

`apps/site/src/pages/docs/__tests__/example-code-gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = resolve(here, '../components');

// Every live demo on a component page must show its source. This catches a demo
// that ships without a Code tab (an <Example> missing the `code` prop).
describe('component-page demos expose their source', () => {
  const files = readdirSync(componentsDir).filter((f) => f.endsWith('.mdx'));

  for (const file of files) {
    it(`${file}: every <Example> passes code`, () => {
      const src = readFileSync(resolve(componentsDir, file), 'utf8');
      // Match each opening <Example ...> tag and require a `code` attribute.
      const openTags = src.match(/<Example(\s[^>]*?)?>/g) ?? [];
      for (const tag of openTags) {
        expect(tag, `${file}: ${tag}`).toMatch(/\bcode=/);
      }
    });
  }
});
```

- [ ] **Step 2: Run the gate**

Run: `pnpm --filter site exec vitest run src/pages/docs/__tests__/example-code-gate.test.ts`
Expected: PASS (all component pages migrated in Tasks 7-8 carry `code`). If a page fails, it was missed in migration; fix that page.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/docs/__tests__/example-code-gate.test.ts
git commit -m "test(site): gate that every component demo shows its source"
```

---

## Task 10: Full CI mirror + size note

- [ ] **Step 1: Run the six-step CI mirror in order**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

Expected: all pass. If `format:check` fails, run `pnpm format`, re-stage, amend/commit, and re-run.

- [ ] **Step 2: Note the docs-page size delta**

The highlighted source HTML now ships in each component page's payload (passed as a prop string). This is docs-site content, tracked separately from framework runtime size. When the client-size comment runs on the PR, confirm the delta is the expected per-page content growth and not a framework-runtime regression. Record the observation in the PR description.

- [ ] **Step 3: Final working-tree review (format:check trap)**

Run: `git status` and `git diff --stat`
Expected: clean tree, no format-dirty demo/test files. (Prior multi-file docs work has shipped format-dirty files when per-task commits skipped `pnpm format`; this final check catches it.)

---

## Self-review notes (for the implementer)

- **Render-all-panels is a behavior change for CodeTabs.** The old component destroyed the inactive panel; the new one hides it. Task 5 Step 1 updates the test accordingly. Don't "fix" the test back to `toBeNull()`.
- **Two imports per WYSIWYG page** (component `.js` + source `.tsx?highlighted`) is intentional and typed via the ambient `*?highlighted` module. Explorer pages import the source from the `*Example.tsx` core, not the `*Demo.tsx` harness.
- **CSS isn't typechecked or format-checked.** Verify the `docs-codetabs`→`docs-tabs` rename left no stragglers (`rg docs-codetabs apps/site/src` must be empty) and spot-check appearance in the browser.
- **`code == null`** (not falsy) guards the plain-frame fallback, so an empty-string `code` would still render tabs; demos always pass real highlighted HTML, so this is fine.
