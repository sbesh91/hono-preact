import { describe, it, expect } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineSocket } from '../define-socket.js';
import { defineRoom } from '../define-room.js';
import { defineChannel } from '../define-channel.js';

// The stamp is server-resolution-only, so it is not declared on the client
// ref types; read it structurally the way route-binding-guard does.
const routeIdOf = (v: unknown): string | undefined =>
  (v as { __routeId?: string }).__routeId;

describe('serverRoute(r).socket / .room route stamping', () => {
  const route = serverRoute('/admin/chat');
  const channel = defineChannel('board/:boardId')<{ n: number }>();

  it('.socket stamps the declared pattern as __routeId', () => {
    const ref = route.socket<{ ping: true }, { pong: true }>({});
    expect(routeIdOf(ref)).toBe('/admin/chat');
  });

  it('.room stamps the declared pattern as __routeId', () => {
    const ref = route.room(channel, {});
    expect(routeIdOf(ref)).toBe('/admin/chat');
  });

  it('bare defineSocket / defineRoom stay unstamped (route-independent)', () => {
    expect(routeIdOf(defineSocket({}))).toBeUndefined();
    expect(routeIdOf(defineRoom(channel, {}))).toBeUndefined();
  });

  it('stamped refs keep their ref-methods attached (SSR contract)', () => {
    const sock = route.socket({});
    const room = route.room(channel, {});
    expect(typeof (sock as { useSocket?: unknown }).useSocket).toBe('function');
    expect(typeof (room as { useRoom?: unknown }).useRoom).toBe('function');
  });

  it('handler fields survive the stamp (spread copies, not replaces)', () => {
    const open = () => {};
    const ref = route.socket({ open });
    expect((ref as { open?: unknown }).open).toBe(open);
  });

  it('.socket still stamps __routeId (route binding unchanged by params wire)', () => {
    const ref = serverRoute('/board/:id').socket<
      { ping: true },
      { pong: true }
    >({});
    expect((ref as { __routeId?: string }).__routeId).toBe('/board/:id');
  });
});
