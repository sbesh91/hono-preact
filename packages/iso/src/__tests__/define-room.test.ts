import { describe, it, expect } from 'vitest';
import { defineRoom, _defineRouteRoom, type RoomDef } from '../define-room.js';
import { defineChannel, type Channel } from '../define-channel.js';
import { defineSocket } from '../define-socket.js';

type ChatMsg = { kind: 'chat'; text: string };
type ChatState = { name: string };

describe('defineRoom (runtime def)', () => {
  it('returns a def carrying the channel and the handler callbacks', () => {
    const channel = defineChannel('room/:roomId')<ChatMsg>();
    const onJoin = () => {};
    const onMessage = () => {};
    const presence = (): ChatState => ({ name: 'anon' });

    const ref = defineRoom(channel, { onJoin, onMessage, presence });

    // The def doubles as the client ref at the type level, but at runtime it is
    // the RoomDef the server (Task 4) reads. Read it back through that type.
    const def = ref as unknown as RoomDef<
      ChatMsg,
      ChatMsg,
      ChatState,
      undefined,
      { roomId: string }
    >;

    expect(def.channel).toBe(channel);
    expect(def.channel.name).toBe('room/:roomId');
    expect(def.onJoin).toBe(onJoin);
    expect(def.onMessage).toBe(onMessage);
    expect(def.presence).toBe(presence);
  });

  it('is distinguishable from a plain socket def via the `channel` discriminator', () => {
    const channel = defineChannel('room/:roomId')<ChatMsg>();
    const roomRef = defineRoom(channel, {});
    const socketRef = defineSocket<ChatMsg, ChatMsg>({});

    // A RoomDef carries `channel`; a SocketDef never does. The server registry
    // (Task 4/5) branches socket-vs-room on the presence of this field.
    const room = roomRef as unknown as Record<string, unknown>;
    const socket = socketRef as unknown as Record<string, unknown>;

    expect('channel' in room).toBe(true);
    expect('channel' in socket).toBe(false);
  });

  it("throws for a hand-rolled channel that bypasses defineChannel's name validator", () => {
    // `Channel` is a public type export, so a hand-rolled `{ name, key }`
    // literal type-checks as a Channel without ever running through
    // defineChannel's assertConformingChannelName. Left unvalidated, this
    // would collapse every connection onto the single literal topic
    // 'board:boardId' (the colon is not at the segment start, so
    // interpolatePattern never substitutes it), silently merging every
    // resource's presence roster and broadcasts into one shared channel.
    const badChannel: Channel<'board:boardId', unknown> = {
      name: 'board:boardId',
      key: () => 'board:boardId' as never,
    };
    expect(() => defineRoom(badChannel, {})).toThrow(/board:boardId/);
    expect(() => defineRoom(badChannel, {})).toThrow(
      /not a valid channel param/
    );
  });

  it("names 'defineRoom' (not 'defineChannel') in the thrown message for a hand-rolled channel", () => {
    // The channel never went through defineChannel, so blaming
    // 'defineChannel(...)' in the message would point the author at a call
    // they never made. The message must name the constructor they actually
    // called.
    const badChannel: Channel<'board:boardId', unknown> = {
      name: 'board:boardId',
      key: () => 'board:boardId' as never,
    };
    expect(() => defineRoom(badChannel, {})).toThrow(
      /^defineRoom\('board:boardId'\):/
    );
  });

  it("names 'serverRoute(r).room' in the thrown message when the hand-rolled channel reaches the route-bound constructor", () => {
    const badChannel: Channel<'board:boardId', unknown> = {
      name: 'board:boardId',
      key: () => 'board:boardId' as never,
    };
    expect(() => _defineRouteRoom('/board', badChannel, {})).toThrow(
      /^serverRoute\(r\)\.room\('board:boardId'\):/
    );
  });
});
