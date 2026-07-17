// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/preact';
import type { LoaderState } from 'hono-preact';
import type { ProjectInsights } from '../../../pages/demo/board-insights.js';
import { renderInsightsBody } from '../InsightsPanel.js';

const stats: ProjectInsights = {
  total: 7,
  byStatus: { backlog: 2, in_progress: 1, in_review: 4, done: 3 },
  oldestOpenDays: 5,
  mode: 'quick',
};

const successState: LoaderState<ProjectInsights> = {
  status: 'success',
  data: stats,
};

afterEach(() => cleanup());

describe('renderInsightsBody', () => {
  it('renders the stats with no error text on a clean success state', () => {
    const state: LoaderState<ProjectInsights> = {
      status: 'success',
      data: stats,
    };
    render(renderInsightsBody(state, null, 'inf', {}, () => {}, false));

    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText(/Backlog:/)).toBeTruthy();
    expect(screen.getByText(/oldest open:/)).toBeTruthy();
    expect(screen.getByText('5d')).toBeTruthy();
    expect(screen.queryByText(/refresh failed/)).toBeNull();
  });

  // Regression pin for d45dcee9: a stale error (a refresh that failed over
  // already-loaded stats) must keep the stats mounted AND surface the inline
  // failure text, rather than unmounting the panel's content.
  it('keeps the stats mounted and shows the inline failure on a stale error', () => {
    const boom = new Error('boom');
    const state: LoaderState<ProjectInsights> = {
      status: 'error',
      error: boom,
      data: stats,
    };
    render(renderInsightsBody(state, boom, 'inf', {}, () => {}, false));

    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('5d')).toBeTruthy();
    expect(screen.getByText(/refresh failed: boom/)).toBeTruthy();
  });

  it('renders the computing line while loading', () => {
    const state: LoaderState<ProjectInsights> = { status: 'loading' };
    render(renderInsightsBody(state, null, 'inf', {}, () => {}, false));

    expect(screen.getByText(/Computing insights/)).toBeTruthy();
  });

  // Pin for the query-knob composition in boardHref: the deep-analysis link
  // must carry the current ?priority= filter forward alongside ?insights=deep,
  // not drop it.
  it('threads the current priority filter into the deep-analysis link', () => {
    const state: LoaderState<ProjectInsights> = {
      status: 'success',
      data: stats,
    };
    render(
      renderInsightsBody(
        state,
        null,
        'inf',
        { priority: 'high' },
        () => {},
        false
      )
    );

    const link = screen.getByRole('link', { name: /Run deep analysis/ });
    expect(link.getAttribute('href')).toBe(
      '/demo/projects/inf?priority=high&insights=deep'
    );
  });

  // Pin for the same composition on the way back: the "back to quick
  // insights" link must keep the priority filter and drop only ?insights=.
  it('threads the current priority filter into the back-to-quick link', () => {
    const state: LoaderState<ProjectInsights> = {
      status: 'success',
      data: { ...stats, mode: 'deep' },
    };
    render(
      renderInsightsBody(
        state,
        null,
        'inf',
        { priority: 'high' },
        () => {},
        false
      )
    );

    const link = screen.getByRole('link', { name: /Back to quick insights/ });
    expect(link.getAttribute('href')).toBe('/demo/projects/inf?priority=high');
  });

  it('renders a Recompute control that fires the callback', () => {
    const onRecompute = vi.fn();
    render(
      renderInsightsBody(successState, null, 'inf', {}, onRecompute, false)
    );
    const btn = screen.getByRole('button', { name: /recompute/i });
    fireEvent.click(btn);
    expect(onRecompute).toHaveBeenCalledTimes(1);
  });

  it('disables the Recompute control while reloading', () => {
    render(renderInsightsBody(successState, null, 'inf', {}, () => {}, true));
    const btn = screen.getByRole('button', { name: /recompute/i });
    expect(btn).toHaveProperty('disabled', true);
  });
});
