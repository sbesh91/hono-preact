import type { SocketDef } from '@hono-preact/iso/internal';
import { makeRegistrySeam } from './registry-seam.js';

type AnySocketDef = SocketDef<unknown, unknown, unknown>;

// The socket-registry seam (see registry-seam.ts for the cross-isolate contract).
const seam = makeRegistrySeam<AnySocketDef>();
export const installSocketRegistry = seam.install;
export const getSocketRegistry = seam.get;
export const __resetSocketRegistryForTesting = seam.reset;
