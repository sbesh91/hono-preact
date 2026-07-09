import { describe, it, expect } from 'vitest';
import { generateClientEntrySource } from '../client-entry.js';

describe('client entry global CSS import', () => {
  it('imports the global stylesheet first when configured', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
      cssGlobalAbsPath: '/proj/src/styles/root.css',
    });
    expect(src.startsWith(`import '/proj/src/styles/root.css';`)).toBe(true);
  });

  it('emits no CSS import when not configured', () => {
    const src = generateClientEntrySource({
      routesAbsPath: '/proj/src/routes.ts',
    });
    expect(src).not.toContain('.css');
  });
});
