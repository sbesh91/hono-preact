import { definePage } from '@hono-preact/iso';
import type { FunctionComponent } from 'preact';
import { loader } from './live-stats.server.js';

const LiveStatsPage: FunctionComponent = () => {
  const stats = loader.useData();
  const error = loader.useError();

  return (
    <section class="p-1 space-y-3">
      <h1 class="text-xl font-semibold">Live stats</h1>
      {error && (
        <p class="text-yellow-700 bg-yellow-100 p-2">
          Live updates paused: {error.message}
        </p>
      )}
      <dl class="grid grid-cols-3 gap-4">
        <div>
          <dt class="text-sm text-gray-600">Tick</dt>
          <dd class="text-2xl">{stats.tick}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-600">Visitors</dt>
          <dd class="text-2xl">{stats.visitors}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-600">Load</dt>
          <dd class="text-2xl">{(stats.load * 100).toFixed(1)}%</dd>
        </div>
      </dl>
      <p class="text-xs text-gray-500">
        The numbers above stream from the server one tick per second; tick stops at 30.
      </p>
    </section>
  );
};
LiveStatsPage.displayName = 'LiveStatsPage';

export default definePage(LiveStatsPage, {
  loader,
  fallback: <p class="p-1">Loading live stats…</p>,
});
