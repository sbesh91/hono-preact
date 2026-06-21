import { describe, it, expect } from 'vitest';
import { encodeEnvelope, decodeEnvelope } from '../room-envelope.js';
import type { RoomEnvelope, PresenceMember } from '../room-envelope.js';

type TestMsg = { text: string };
type TestState = { name: string; color: string };

describe('room-envelope encode/decode', () => {
  it('round-trips a msg envelope with from + msg', () => {
    const e: RoomEnvelope<TestMsg, TestState> = {
      from: 'user-1',
      t: 'msg',
      msg: { text: 'hello' },
    };
    const decoded = decodeEnvelope<TestMsg, TestState>(encodeEnvelope(e));
    expect(decoded).toEqual(e);
  });

  it('round-trips a presence join envelope with from + state', () => {
    const e: RoomEnvelope<TestMsg, TestState> = {
      from: 'user-2',
      t: 'presence',
      op: 'join',
      state: { name: 'Alice', color: 'blue' },
    };
    const decoded = decodeEnvelope<TestMsg, TestState>(encodeEnvelope(e));
    expect(decoded).toEqual(e);
  });

  it('round-trips a presence update envelope', () => {
    const e: RoomEnvelope<TestMsg, TestState> = {
      from: 'user-2',
      t: 'presence',
      op: 'update',
      state: { name: 'Alice', color: 'red' },
    };
    const decoded = decodeEnvelope<TestMsg, TestState>(encodeEnvelope(e));
    expect(decoded).toEqual(e);
  });

  it('round-trips a presence leave envelope without state', () => {
    const e: RoomEnvelope<TestMsg, TestState> = {
      from: 'user-2',
      t: 'presence',
      op: 'leave',
    };
    const decoded = decodeEnvelope<TestMsg, TestState>(encodeEnvelope(e));
    expect(decoded).toEqual(e);
  });

  it('round-trips a snapshot envelope with members', () => {
    const members: Array<PresenceMember<TestState>> = [
      { id: 'user-1', state: { name: 'Alice', color: 'blue' } },
      { id: 'user-2', state: { name: 'Bob', color: 'green' } },
    ];
    const e: RoomEnvelope<TestMsg, TestState> = {
      t: 'snapshot',
      members,
    };
    const decoded = decodeEnvelope<TestMsg, TestState>(encodeEnvelope(e));
    expect(decoded).toEqual(e);
  });

  it('snapshot with empty members array', () => {
    const e: RoomEnvelope<TestMsg, TestState> = {
      t: 'snapshot',
      members: [],
    };
    const decoded = decodeEnvelope<TestMsg, TestState>(encodeEnvelope(e));
    expect(decoded).toEqual(e);
  });

  it('encodeEnvelope returns a JSON string', () => {
    const e: RoomEnvelope<TestMsg, TestState> = {
      from: 'user-1',
      t: 'msg',
      msg: { text: 'hi' },
    };
    const raw = encodeEnvelope(e);
    expect(typeof raw).toBe('string');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
