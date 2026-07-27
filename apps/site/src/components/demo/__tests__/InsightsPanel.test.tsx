// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import type { ComponentChildren } from 'preact';
import { signal, type LoaderState } from 'hono-preact';
import type { ProjectInsights } from '../../../pages/demo/board-insights.js';
import {
  renderInsightsBody,
  shouldRecomputeInsights,
  type InsightsProbe,
} from '../InsightsPanel.js';

// The mode links render as NavLink, which reads useLocation() from
// preact-iso's routing context; wrap every render the same way the app does.
function renderWithLocation(children: ComponentChildren) {
  return render(<LocationProvider>{children}</LocationProvider>);
}

const stats: ProjectInsights = {
  total: 7,
  byStatus: { backlog: 2, in_progress: 1, in_review: 4, done: 3 },
  oldestOpenDays: 5,
  mode: 'quick',
};

afterEach(() => cleanup());

describe('renderInsightsBody', () => {
  it('renders the stats with no error text on a clean success state', () => {
    const state = signal<LoaderState<ProjectInsights>>({
      status: 'success',
      data: stats,
    });
    renderWithLocation(renderInsightsBody(state, null, 'inf', {}));

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
    const state = signal<LoaderState<ProjectInsights>>({
      status: 'error',
      error: boom,
      data: stats,
    });
    renderWithLocation(renderInsightsBody(state, boom, 'inf', {}));

    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('5d')).toBeTruthy();
    expect(screen.getByText(/refresh failed: boom/)).toBeTruthy();
  });

  it('renders the computing line while loading', () => {
    const state = signal<LoaderState<ProjectInsights>>({ status: 'loading' });
    renderWithLocation(renderInsightsBody(state, null, 'inf', {}));

    expect(screen.getByText(/Computing insights/)).toBeTruthy();
  });

  // Pin for the query-knob composition in boardHref: the deep-analysis link
  // must carry the current ?priority= filter forward alongside ?insights=deep,
  // not drop it.
  it('threads the current priority filter into the deep-analysis link', () => {
    const state = signal<LoaderState<ProjectInsights>>({
      status: 'success',
      data: stats,
    });
    renderWithLocation(
      renderInsightsBody(state, null, 'inf', { priority: 'high' })
    );

    const link = screen.getByRole('link', { name: /Run deep analysis/ });
    expect(link.getAttribute('href')).toBe(
      '/demo/projects/inf?priority=high&insights=deep'
    );
  });

  // Pin for the same composition on the way back: the "back to quick
  // insights" link must keep the priority filter and drop only ?insights=.
  it('threads the current priority filter into the back-to-quick link', () => {
    const state = signal<LoaderState<ProjectInsights>>({
      status: 'success',
      data: { ...stats, mode: 'deep' },
    });
    renderWithLocation(
      renderInsightsBody(state, null, 'inf', { priority: 'high' })
    );

    const link = screen.getByRole('link', { name: /Back to quick insights/ });
    expect(link.getAttribute('href')).toBe('/demo/projects/inf?priority=high');
  });
});

// This is the demo's proof that the signals data layer buys something. Before
// the split, InsightsBody read `useData().value` and rendered the whole strip,
// so a recompute re-rendered all seven stats plus the mode link. Each stat now
// holds its own `useComputed` off the loader signal, so a recompute re-renders
// only the stats whose numbers actually moved.
//
// Asserting SIBLING render counts is the point. A test that only checked the
// changed cell updated would pass just as well against the un-split version,
// which is the trap the umbrella review found across this branch's own suite:
// "granularity" tests that measured the parent, which subscribes to nothing.
describe('per-stat granularity', () => {
  function mount(initial: ProjectInsights) {
    const state = signal<LoaderState<ProjectInsights>>({
      status: 'success',
      data: initial,
    });
    const cells: Record<string, number> = {};
    let strip = 0;
    let modeLink = 0;
    const probe: InsightsProbe = {
      cell: (key) => (cells[key] = (cells[key] ?? 0) + 1),
      modeLink: () => (modeLink += 1),
      strip: () => (strip += 1),
    };
    renderWithLocation(renderInsightsBody(state, null, 'inf', {}, probe));
    const counts = (): Record<string, number> => ({
      ...cells,
      __strip: strip,
      __modeLink: modeLink,
    });
    return { state, counts };
  }

  it('re-renders only the stats whose numbers changed', async () => {
    const { state, counts } = mount(stats);
    const before = counts();

    // One task moves backlog -> done. `total`, `in_progress`, `in_review`,
    // `oldestOpenDays` and `mode` are all untouched.
    await act(async () => {
      state.value = {
        status: 'success',
        data: {
          ...stats,
          byStatus: { ...stats.byStatus, backlog: 1, done: 4 },
        },
      };
    });
    const after = counts();

    // The two that moved re-rendered...
    expect(after.backlog).toBe(before.backlog + 1);
    expect(after.done).toBe(before.done + 1);
    // ...and nothing else did, including the strip that owns them.
    expect(after.total).toBe(before.total);
    expect(after.in_progress).toBe(before.in_progress);
    expect(after.in_review).toBe(before.in_review);
    expect(after.oldest).toBe(before.oldest);
    expect(after.__modeLink).toBe(before.__modeLink);
    expect(after.__strip).toBe(before.__strip);

    // And the DOM actually updated, so this is granularity rather than a
    // subscription that was never wired up.
    expect(screen.getByText(/Done:/).textContent).toBe('Done: 4');
    expect(screen.getByText(/Backlog:/).textContent).toBe('Backlog: 1');
  });

  it('re-renders nothing on a reload that returns identical numbers', async () => {
    const { state, counts } = mount(stats);
    const before = counts();

    // The stale-while-revalidate churn a reload actually produces: the status
    // flips to `revalidating` over the same data, then back. Every projection
    // below is unchanged, so `computed`'s === dedupe absorbs all of it.
    await act(async () => {
      state.value = { status: 'revalidating', data: stats };
    });
    await act(async () => {
      state.value = { status: 'success', data: { ...stats } };
    });

    expect(counts()).toEqual(before);
  });
});

describe('shouldRecomputeInsights', () => {
  it('recomputes when the same project mutates (signature changes)', () => {
    expect(
      shouldRecomputeInsights(
        { slug: 'inf', taskSignature: 't-1:backlog' },
        { slug: 'inf', taskSignature: 't-1:done' }
      )
    ).toBe(true);
  });

  it('does not recompute when the signature is unchanged (mount / ?priority= change)', () => {
    expect(
      shouldRecomputeInsights(
        { slug: 'inf', taskSignature: 't-1:backlog' },
        { slug: 'inf', taskSignature: 't-1:backlog' }
      )
    ).toBe(false);
  });

  it('does not recompute on a project switch (the route-bound loader already re-ran)', () => {
    expect(
      shouldRecomputeInsights(
        { slug: 'inf', taskSignature: 't-1:backlog' },
        { slug: 'web', taskSignature: 't-9:done' }
      )
    ).toBe(false);
  });
});
