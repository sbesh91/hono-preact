import type { RoomDef } from '@hono-preact/iso/internal';
import { makeRegistrySeam } from './registry-seam.js';

type AnyRoomDef = RoomDef<unknown, unknown, unknown, unknown, unknown>;

// The room-registry seam (see registry-seam.ts for the cross-isolate contract).
const seam = makeRegistrySeam<AnyRoomDef>();
export const installRoomRegistry = seam.install;
export const getRoomRegistry = seam.get;
export const __resetRoomRegistryForTesting = seam.reset;
