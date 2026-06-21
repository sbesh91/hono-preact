import { describe, it, expect, afterEach } from 'vitest';
import {
  installWebSocketUpgrader,
  getWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
} from '../ws-upgrader.js';

afterEach(() => __resetWebSocketUpgraderForTesting());

describe('ws-upgrader seam', () => {
  it('throws a clear error when no upgrader is installed', () => {
    expect(() => getWebSocketUpgrader()).toThrow(/no websocket upgrader/i);
  });

  it('returns the installed upgrader', () => {
    const fake = ((createEvents) => createEvents) as never;
    installWebSocketUpgrader(fake);
    expect(getWebSocketUpgrader()).toBe(fake);
  });
});
