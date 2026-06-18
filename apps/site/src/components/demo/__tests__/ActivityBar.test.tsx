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

// ActivityBar reads serverLoaders.activity.useStream(...) at module scope, so
// mock the server module to feed the bar canned stream state. The streaming
// transport itself is covered by packages/iso's useStream hook test.
vi.mock('../../../pages/demo/projects-shell.server.js', () => ({
  serverLoaders: {
    activity: { useStream: () => streamResult },
  },
}));

import { ActivityBar } from '../ActivityBar.js';

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
