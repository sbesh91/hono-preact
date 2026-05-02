import { describe, expect, it } from 'vitest';
import { nav } from '../nav.js';

describe('docs nav', () => {
  it('every entry has a title, route, and icon component', () => {
    for (const section of nav) {
      expect(section.heading).toBeTruthy();
      for (const entry of section.entries) {
        expect(entry.title).toBeTruthy();
        expect(entry.route).toMatch(/^\/docs/);
        expect(typeof entry.icon).toBe('function');
      }
    }
  });

  it('routes are unique', () => {
    const routes = nav.flatMap((s) => s.entries.map((e) => e.route));
    expect(new Set(routes).size).toBe(routes.length);
  });
});
