import { installHistoryShim } from './internal/history-shim.js';
import { installNavTransitionScheduler } from './internal/route-change.js';
import { installStreamRegistry } from './internal/stream-registry.js';

/**
 * Installs the framework's client runtime services, in order: the history
 * shim (back/forward navigation-direction tracking), the nav-transition
 * scheduler (wraps route re-renders in document.startViewTransition), and
 * the stream registry (live-loader stream delivery and reconnection).
 *
 * The generated client entry (virtual:hono-preact/client) calls this before
 * hydrating. A custom `clientEntry` module must do the same, before its own
 * hydrate() call; skipping it silently disables view transitions, direction
 * tracking, and live-loader streams. Safe to call more than once: each
 * installer guards against double-install.
 */
export function bootClient(): void {
  installHistoryShim();
  installNavTransitionScheduler();
  installStreamRegistry();
}
