import { describe, expect, it } from 'vitest';
import { nav } from '../nav.js';

describe('docs nav', () => {
  it('every area has an id, label, icon component, and /docs basePath', () => {
    for (const area of nav) {
      expect(area.id).toBeTruthy();
      expect(area.label).toBeTruthy();
      expect(typeof area.icon).toBe('function');
      expect(area.basePath).toMatch(/^\/docs/);
    }
  });

  it('every section has a heading and an icon component', () => {
    for (const area of nav) {
      for (const section of area.sections) {
        expect(section.heading).toBeTruthy();
        expect(typeof section.icon).toBe('function');
        expect(section.entries.length).toBeGreaterThan(0);
      }
    }
  });

  it('every entry has a title and a /docs route', () => {
    for (const area of nav) {
      for (const section of area.sections) {
        for (const entry of section.entries) {
          expect(entry.title).toBeTruthy();
          expect(entry.route).toMatch(/^\/docs/);
        }
      }
    }
  });

  it('component-area routes live under /docs/components', () => {
    const components = nav.find((a) => a.id === 'components');
    expect(components).toBeTruthy();
    for (const section of components!.sections) {
      for (const entry of section.entries) {
        expect(
          entry.route === '/docs/components' ||
            entry.route.startsWith('/docs/components/')
        ).toBe(true);
      }
    }
  });

  it('routes are unique across all areas', () => {
    const routes = nav.flatMap((a) =>
      a.sections.flatMap((s) => s.entries.map((e) => e.route))
    );
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('lists Popover, Tooltip, Menu, and Context Menu under Overlays', () => {
    const components = nav.find((a) => a.id === 'components')!;
    const overlays = components.sections.find((s) => s.heading === 'Overlays')!;
    const routes = overlays.entries.map((e) => e.route);
    expect(routes).toContain('/docs/components/popover');
    expect(routes).toContain('/docs/components/tooltip');
    expect(routes).toContain('/docs/components/menu');
    expect(routes).toContain('/docs/components/context-menu');
  });

  it('lists usePosition, useDismiss, and useFocusReturn under Foundations', () => {
    const components = nav.find((a) => a.id === 'components')!;
    const foundations = components.sections.find(
      (s) => s.heading === 'Foundations'
    )!;
    const routes = foundations.entries.map((e) => e.route);
    expect(routes).toContain('/docs/components/use-position');
    expect(routes).toContain('/docs/components/use-dismiss');
    expect(routes).toContain('/docs/components/use-focus-return');
  });
});
