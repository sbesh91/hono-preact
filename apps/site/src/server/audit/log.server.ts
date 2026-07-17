// A src/server registry module: route-less server units that live in the
// blessed `src/server` folder (organized by domain, here `audit/`) instead of
// next to a route's view. The build globs everything under `src/server/**` into
// the server bundle, so these register without a `server:` route field.
//
// Being route-less (bare defineLoader/defineAction, no serverRoute), they are
// addressed by module key: the loader over the loaders RPC, the action via the
// handler's moduleKey fallback. An action invoked from a page still runs behind
// that page's `use` gates.
import { defineLoader, defineAction } from 'hono-preact';
import { recentAudit } from '../../demo/audit-log.js';

export const serverLoaders = {
  // Latest audit entries, callable from any page via its client stub.
  recent: defineLoader(
    async (): Promise<{ entries: string[] }> => ({ entries: recentAudit() })
  ),
};

export const serverActions = {
  record: defineAction(async (_ctx, note: unknown) => ({ recorded: note })),
};
