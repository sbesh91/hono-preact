// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { act } from 'preact/test-utils';
import { ActivityBar } from '../ActivityBar.js';
import type { ActivityEvent } from '../../../demo/activity-stream.js';

// Minimal EventSource stub: captures the latest instance so the test can drive
// onopen/onmessage. happy-dom has no EventSource.
class MockEventSource {
  static last: MockEventSource | null = null;
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
}

const moved = (id: string, title: string): ActivityEvent => ({
  id,
  kind: 'task-moved',
  at: 1,
  actor: 'Bob',
  taskId: 't-1',
  taskTitle: title,
  projectSlug: 'inf',
  to: 'in_review',
  simulated: true,
});

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource);
  MockEventSource.last = null;
  window.history.pushState({}, '', '/demo/projects/inf');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ActivityBar', () => {
  it('accumulates streamed events and shows the latest line + count', async () => {
    render(<ActivityBar />);
    const es = MockEventSource.last!;
    expect(es.url).toBe('/api/demo/activity');

    await act(async () => {
      es.onopen?.();
      es.onmessage?.({ data: JSON.stringify(moved('e1', 'Cache key')) });
      es.onmessage?.({ data: JSON.stringify(moved('e2', 'Stream bodies')) });
    });

    // Latest event (e2) is shown; count reflects both.
    expect(screen.getByText(/Stream bodies/)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('expands to reveal the full feed', async () => {
    render(<ActivityBar />);
    const es = MockEventSource.last!;
    await act(async () => {
      es.onmessage?.({ data: JSON.stringify(moved('e1', 'Cache key')) });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /activity/i }));
    });
    // Feed region appears when expanded.
    expect(screen.getByRole('log')).toBeTruthy();
  });

  it('renders nothing outside /demo/projects', () => {
    window.history.pushState({}, '', '/docs/intro');
    const { container } = render(<ActivityBar />);
    expect(container.innerHTML).toBe('');
    expect(MockEventSource.last).toBeNull(); // no stream opened off-app
  });

  it('hides and is removed from the app when navigation leaves /demo/projects (no View Transitions API needed)', async () => {
    const { container } = render(<ActivityBar />);
    expect(MockEventSource.last).not.toBeNull(); // stream open on /demo/projects

    await act(async () => {
      window.history.pushState({}, '', '/docs/intro');
    });

    // The pushState wrapper updated the path with no startViewTransition involved.
    expect(container.innerHTML).toBe('');
  });
});
