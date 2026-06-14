// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import { render } from '@testing-library/preact';
import { contentRoutes } from '../content-routes.js';

// Build a fake glob map. Each value is a lazy importer whose `default` is a
// component rendering `label`, mirroring `import.meta.glob`'s shape.
const mod =
  (label: string) =>
  (): Promise<unknown> =>
    Promise.resolve({ default: () => h('p', null, label) });

async function renderView(route: {
  view?: () => Promise<{ default: unknown }>;
}) {
  const { default: View } = await route.view!();
  return render(h(View as never, {}));
}

describe('contentRoutes slug derivation', () => {
  it('strips the common dir + extension and collapses index', () => {
    const routes = contentRoutes({
      './pages/docs/index.mdx': mod('home'),
      './pages/docs/quick-start.mdx': mod('qs'),
      './pages/docs/components/index.mdx': mod('comp'),
      './pages/docs/components/dialog.mdx': mod('dialog'),
    });
    expect(routes.map((r) => r.path).sort()).toEqual(
      ['', 'components', 'components/dialog', 'quick-start'].sort()
    );
  });

  it('handles a single-key map (dir prefix from the one key)', () => {
    const routes = contentRoutes({ './pages/docs/index.mdx': mod('x') });
    expect(routes[0].path).toBe('');
  });

  it('honors an explicit base', () => {
    const routes = contentRoutes(
      { 'content/a.mdx': mod('a'), 'content/b.mdx': mod('b') },
      { base: 'content/' }
    );
    expect(routes.map((r) => r.path).sort()).toEqual(['a', 'b']);
  });

  it('honors a slug override (ignores base derivation)', () => {
    const routes = contentRoutes(
      { 'x/y.mdx': mod('y') },
      { slug: (k) => k.replace(/\.mdx$/, '').toUpperCase() }
    );
    expect(routes[0].path).toBe('X/Y');
  });
});

describe('contentRoutes view', () => {
  it('wraps the module default in a single-root default <div>', async () => {
    const [route] = contentRoutes({ './a/index.mdx': mod('hello') });
    const { container } = await renderView(route);
    expect(container.childNodes.length).toBe(1);
    expect((container.firstChild as HTMLElement).tagName).toBe('DIV');
    expect(container.textContent).toContain('hello');
  });

  it('honors a custom wrapper', async () => {
    const Wrapper = ({ children }: { children: ComponentChildren }) =>
      h('article', { class: 'mdx-content' }, children);
    const [route] = contentRoutes(
      { './a/index.mdx': mod('hi') },
      { wrapper: Wrapper }
    );
    const { container } = await renderView(route);
    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('ARTICLE');
    expect(root.className).toBe('mdx-content');
  });

  it('forwards route props to the content component', async () => {
    const Probe = (props: { path?: string }) =>
      h('span', null, props.path ?? 'no-path');
    const [route] = contentRoutes({
      './a/index.mdx': () => Promise.resolve({ default: Probe }),
    });
    const { default: View } = await route.view!();
    const { container } = render(h(View as never, { path: '/a' }));
    expect(container.textContent).toContain('/a');
  });
});
