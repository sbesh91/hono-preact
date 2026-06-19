// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from '@testing-library/preact';
import type { ActivityEvent } from '../../../demo/activity-stream.js';

type StreamState = {
  data: ActivityEvent[];
  status: string;
  error: Error | null;
};
let streamResult: StreamState;

// ActivityBar is `serverLoaders.activity.View(render, opts)` at module scope, so
// mock the loader's `.View` to a passthrough that feeds the bar's render fn
// canned stream state. The streaming transport + accumulation are covered by
// packages/iso's define-loader-view-stream test.
vi.mock('../../../pages/demo/projects-shell.server.js', () => ({
  serverLoaders: {
    activity: {
      View: (render: (args: unknown) => unknown) => () =>
        render({
          data: streamResult.data,
          status: streamResult.status,
          error: streamResult.error,
          reload: () => {},
        }),
    },
  },
}));

import {
  ActivityBar,
  ConnectingBar,
  accumulateActivity,
  ACTIVITY_MAX,
} from '../ActivityBar.js';

function ev(id: string, actor: string, title: string): ActivityEvent {
  return {
    id,
    kind: 'task-created',
    at: Date.UTC(2026, 0, 1),
    actor,
    taskId: 't-' + id,
    taskTitle: title,
    projectSlug: 'web',
    simulated: false,
  };
}

beforeEach(() => {
  streamResult = { data: [], status: 'connecting', error: null };
});
afterEach(() => cleanup());

describe('ActivityBar', () => {
  it('shows the latest event line and the accumulated count', () => {
    streamResult = {
      data: [ev('2', 'Bob', 'Ship it'), ev('1', 'Alice', 'Draft')],
      status: 'open',
      error: null,
    };
    render(<ActivityBar />);
    expect(screen.getByText(/Bob created "Ship it"/)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('expands to reveal the full feed', () => {
    streamResult = {
      data: [ev('1', 'Alice', 'Draft')],
      status: 'open',
      error: null,
    };
    render(<ActivityBar />);
    fireEvent.click(
      screen.getByRole('button', { name: /toggle activity feed/i })
    );
    const log = screen.getByRole('log');
    expect(log).toBeTruthy();
    // The text appears in both the feed log and the button summary line;
    // scope to the log element so the query is unambiguous.
    expect(within(log).getByText(/Alice created "Draft"/)).toBeTruthy();
  });

  it('shows the listening placeholder before any event', () => {
    streamResult = { data: [], status: 'connecting', error: null };
    render(<ActivityBar />);
    expect(screen.getByText(/Listening for activity/)).toBeTruthy();
  });
});

describe('accumulateActivity (feed reducer)', () => {
  it('prepends new events newest-first', () => {
    const a = accumulateActivity([], ev('1', 'Alice', 'Draft'));
    const b = accumulateActivity(a, ev('2', 'Bob', 'Ship it'));
    expect(b.map((e) => e.id)).toEqual(['2', '1']);
  });

  it('de-dupes a re-yielded head event (same ref, no growth)', () => {
    const a = accumulateActivity([], ev('1', 'Alice', 'Draft'));
    const b = accumulateActivity(a, ev('1', 'Alice', 'Draft'));
    expect(b).toBe(a);
    expect(b.length).toBe(1);
  });

  it('caps the feed at ACTIVITY_MAX, keeping the newest', () => {
    let acc: ActivityEvent[] = [];
    for (let i = 0; i < ACTIVITY_MAX + 5; i++) {
      acc = accumulateActivity(acc, ev(String(i), 'A', `t${i}`));
    }
    expect(acc.length).toBe(ACTIVITY_MAX);
    expect(acc[0].id).toBe(String(ACTIVITY_MAX + 4));
    expect(acc[acc.length - 1].id).toBe(String(5));
  });
});

describe('ConnectingBar (Suspense fallback)', () => {
  it('renders the connecting placeholder with no toggle button', () => {
    render(<ConnectingBar />);
    expect(screen.getByText(/Listening for activity/)).toBeTruthy();
    // Distinguishes the fallback markup from the Feed empty-state, which always
    // renders the expand/collapse toggle button.
    expect(screen.queryByRole('button')).toBeNull();
  });
});
