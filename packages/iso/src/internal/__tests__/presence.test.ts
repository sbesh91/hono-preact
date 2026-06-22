import { describe, it, expect, beforeEach } from 'vitest';
import {
  joinRoom,
  leaveRoom,
  updatePresence,
  roomMembers,
  __resetPresenceForTesting,
} from '../presence.js';

beforeEach(() => {
  __resetPresenceForTesting();
});

describe('presence registry', () => {
  it('lists every joined connection as a member', () => {
    joinRoom('room/demo', 'a', { name: 'Ana' });
    joinRoom('room/demo', 'b', { name: 'Bo' });

    const members = roomMembers('room/demo');
    expect(members).toHaveLength(2);
    expect(members).toContainEqual({ id: 'a', state: { name: 'Ana' } });
    expect(members).toContainEqual({ id: 'b', state: { name: 'Bo' } });
  });

  it('returns an empty list for an unknown topic', () => {
    expect(roomMembers('room/none')).toEqual([]);
  });

  it('stores undefined initial state as a present member', () => {
    joinRoom('room/demo', 'a', undefined);
    expect(roomMembers('room/demo')).toEqual([{ id: 'a', state: undefined }]);
  });

  it('updatePresence replaces a member state in place', () => {
    joinRoom('room/demo', 'a', { typing: false });
    updatePresence('room/demo', 'a', { typing: true });

    expect(roomMembers('room/demo')).toEqual([
      { id: 'a', state: { typing: true } },
    ]);
  });

  it('updatePresence on an unknown topic is a no-op (does not create it)', () => {
    updatePresence('room/ghost', 'a', { typing: true });
    expect(roomMembers('room/ghost')).toEqual([]);
  });

  it('leaveRoom removes a single member but keeps the others', () => {
    joinRoom('room/demo', 'a', 1);
    joinRoom('room/demo', 'b', 2);
    leaveRoom('room/demo', 'a');

    expect(roomMembers('room/demo')).toEqual([{ id: 'b', state: 2 }]);
  });

  it('leaving the last member prunes the topic entirely', () => {
    joinRoom('room/demo', 'a', 1);
    leaveRoom('room/demo', 'a');

    // The topic is gone: roomMembers returns empty and a fresh updatePresence
    // is a no-op (proving the inner map was deleted, not just emptied).
    expect(roomMembers('room/demo')).toEqual([]);
    updatePresence('room/demo', 'a', 99);
    expect(roomMembers('room/demo')).toEqual([]);
  });

  it('isolates members per topic', () => {
    joinRoom('room/x', 'a', 'x-state');
    joinRoom('room/y', 'a', 'y-state');

    expect(roomMembers('room/x')).toEqual([{ id: 'a', state: 'x-state' }]);
    expect(roomMembers('room/y')).toEqual([{ id: 'a', state: 'y-state' }]);
  });
});
