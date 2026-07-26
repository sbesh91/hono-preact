import { describe, it, expect, afterEach } from 'vitest';
import {
  installWebSocketUpgrader,
  getWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
  type WebSocketUpgrader,
} from '../ws-upgrader.js';

afterEach(() => __resetWebSocketUpgraderForTesting());

describe('ws-upgrader seam', () => {
  it('throws a clear error when no upgrader is installed', () => {
    expect(() => getWebSocketUpgrader()).toThrow(/no websocket upgrader/i);
  });

  it('returns the installed upgrader', () => {
    // Never invoked; the seam is asserted by identity.
    const fake: WebSocketUpgrader = () => async (_c, next) => next();
    installWebSocketUpgrader(fake);
    expect(getWebSocketUpgrader()).toBe(fake);
  });
});
