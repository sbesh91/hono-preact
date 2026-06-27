// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from 'hono-preact';
import { RouteLocationsProvider } from 'hono-preact/internal';
import { env } from 'hono-preact/internal/runtime';
import { renderActivityBar, accumulateActivity } from '../ActivityBar.js';
import type { ActivityEvent } from '../../../demo/activity-stream.js';

// Regression guard for the live-loader SSR 500 (review #8 follow-up). On every
// `/demo/projects*` request the projects shell SSRs `<ActivityBar />`. A live
// loader never runs on the server, so its accumulator is undefined and the
// union resolves to `{ status: 'connecting' }`. Before the union migration the
// render fn handed that undefined straight to `<Feed>`, which dereferences
// `events[0]`/`events.map`, throwing during the SSR render.
//
// This drives the REAL render fn (`renderActivityBar`) and the REAL `Feed`/
// `ConnectingBar` it closes over through the REAL `LoaderRef.View` path
// (ViewRenderer + `toStreamState` projection + LoaderHost), NOT the `.View`
// passthrough mock in ActivityBar.test.tsx. The loader is a keyed test fixture
// only because the Vite module-key plugin does not run under vitest, so the
// app's own `serverLoaders.activity` is unkeyed and its boundary cannot resolve
// a location; the connecting-arm behavior under test does not depend on the
// loader instance (the generator never runs on the server).

const MODULE_KEY = 'apps/site/src/components/demo/ActivityBar.ssr.test';

// Never yields: a live loader is skipped on the server, and we assert the
// pre-first-chunk frame, so the body is unused by this test.
async function* activityStream(): AsyncGenerator<ActivityEvent, void, unknown> {
  return;
}

const activityLoader = defineLoader<ActivityEvent>(activityStream, {
  live: true,
  __moduleKey: MODULE_KEY,
});

// Constructed exactly as ActivityBar is, swapping only the (keyed) loader.
const ActivityBar = activityLoader.View<ActivityEvent[]>(renderActivityBar, {
  initial: [],
  reduce: accumulateActivity,
});

// Structurally a preact-iso RouteHook ({ path, searchParams, pathParams }); the
// literal is assignable with no cast. The live loader never runs on the server,
// so the values only need to satisfy the boundary's location lookup.
const LOC = { path: '/demo/projects', searchParams: {}, pathParams: {} };

const originalEnv = env.current;
afterEach(() => {
  env.current = originalEnv;
});

describe('ActivityBar SSR (real .View path, connecting arm)', () => {
  it('renders the connecting fallback on the server without dereferencing undefined stream data', () => {
    const App = () => (
      <LocationProvider>
        <RouteLocationsProvider moduleKey={MODULE_KEY} location={LOC}>
          <ActivityBar />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    env.current = 'server';
    const container = document.createElement('div');
    // The pre-migration `({ data }) => <Feed events={data} />` threw here
    // (`events[0]` on undefined). The connecting arm must render the fallback.
    expect(() => render(<App />, container)).not.toThrow();
    expect(container.textContent).toContain('Listening for activity');
    // The connecting fallback carries no toggle button, which distinguishes it
    // from the Feed empty-state (that always renders the expand/collapse
    // control). Proves the connecting arm rendered, not a data-bearing Feed.
    expect(container.querySelector('button')).toBeNull();

    render(null, container);
  });
});
