import { installHistoryShim } from './internal/history-shim.js';
import { installNavTransitionScheduler } from './internal/route-change.js';
import { installStreamRegistry } from './internal/stream-registry.js';
import { hydrateChannelsFromDocument } from './internal/channel-store.js';

/**
 * Installs the framework's client runtime services, in order: the history
 * shim (back/forward navigation-direction tracking), the nav-transition
 * scheduler (wraps route re-renders in document.startViewTransition), the
 * stream registry (live-loader stream delivery and reconnection), and the
 * channel store hydration (seeds the published-channel store from the SSR
 * bootstrap global, before any client middleware chain runs).
 *
 * The generated client entry (virtual:hono-preact/client) calls this before
 * hydrating. A custom `clientEntry` module must do the same, before its own
 * hydrate() call; skipping it silently disables view transitions, direction
 * tracking, live-loader streams, and the channel bootstrap. Safe to call more
 * than once: each installer guards against double-install.
 */
export function bootClient(): void {
  installHistoryShim();
  installNavTransitionScheduler();
  installStreamRegistry();
  hydrateChannelsFromDocument();
}
