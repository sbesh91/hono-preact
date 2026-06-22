import { describe, it, expect } from 'vitest';
import { defineRoom, type RoomDef } from '../define-room.js';
import { defineChannel } from '../define-channel.js';
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
});
