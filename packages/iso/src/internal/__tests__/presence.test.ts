import { describe, it, expect, beforeEach } from 'vitest';
import {
  joinPresence,
  leavePresence,
  updatePresence,
  presenceMembers,
  __resetPresenceForTesting,
} from '../presence.js';

beforeEach(() => {
  __resetPresenceForTesting();
});

describe('presence registry', () => {
  it('lists every joined connection as a member', () => {
    joinPresence('room/demo', 'a', { name: 'Ana' });
    joinPresence('room/demo', 'b', { name: 'Bo' });

    const members = presenceMembers('room/demo');
    expect(members).toHaveLength(2);
    expect(members).toContainEqual({ id: 'a', state: { name: 'Ana' } });
    expect(members).toContainEqual({ id: 'b', state: { name: 'Bo' } });
  });

  it('returns an empty list for an unknown topic', () => {
    expect(presenceMembers('room/none')).toEqual([]);
  });

  it('stores undefined initial state as a present member', () => {
    joinPresence('room/demo', 'a', undefined);
    expect(presenceMembers('room/demo')).toEqual([
      { id: 'a', state: undefined },
    ]);
  });

  it('updatePresence replaces a member state in place', () => {
    joinPresence('room/demo', 'a', { typing: false });
    updatePresence('room/demo', 'a', { typing: true });

    expect(presenceMembers('room/demo')).toEqual([
      { id: 'a', state: { typing: true } },
    ]);
  });

  it('updatePresence on an unknown topic is a no-op (does not create it)', () => {
    updatePresence('room/ghost', 'a', { typing: true });
    expect(presenceMembers('room/ghost')).toEqual([]);
  });

  it('leavePresence removes a single member but keeps the others', () => {
    joinPresence('room/demo', 'a', 1);
    joinPresence('room/demo', 'b', 2);
    leavePresence('room/demo', 'a');

    expect(presenceMembers('room/demo')).toEqual([{ id: 'b', state: 2 }]);
  });

  it('leaving the last member prunes the topic entirely', () => {
    joinPresence('room/demo', 'a', 1);
    leavePresence('room/demo', 'a');

    // The topic is gone: presenceMembers returns empty and a fresh updatePresence
    // is a no-op (proving the inner map was deleted, not just emptied).
    expect(presenceMembers('room/demo')).toEqual([]);
    updatePresence('room/demo', 'a', 99);
    expect(presenceMembers('room/demo')).toEqual([]);
  });

  it('isolates members per topic', () => {
    joinPresence('room/x', 'a', 'x-state');
    joinPresence('room/y', 'a', 'y-state');

    expect(presenceMembers('room/x')).toEqual([{ id: 'a', state: 'x-state' }]);
    expect(presenceMembers('room/y')).toEqual([{ id: 'a', state: 'y-state' }]);
  });
});
