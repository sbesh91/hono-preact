// A route-BOUND registry unit (Phase 2): it lives in src/server, organized by
// domain, but binds to a real route via serverRoute(), so it inherits that
// route's page-layer `use` gates (here, the requireSession guard that /demo/
// projects carries). The boot guard validates the bound pattern is a real route.
import { serverRoute } from 'hono-preact';

const route = serverRoute('/demo/projects/:projectId');

export const serverLoaders = {
  activity: route.loader(
    async (): Promise<{ events: string[] }> => ({ events: [] })
  ),
};
