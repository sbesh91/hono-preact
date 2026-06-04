import { describe, it, expect } from 'vitest';
import { renderComment } from '../render-size-comment.mjs';

function report(over = {}) {
  return {
    sectionA: {
      core: { total: { gzip: 15000 }, marginalOverCore: { gzip: 15000 } },
      actions: { total: { gzip: 8000 }, marginalOverCore: { gzip: 3000 } },
      loaders: { total: { gzip: 4000 }, marginalOverCore: { gzip: 1000 } },
      ...over.sectionA,
    },
    sectionB: { buckets: { core: 20000, app: 12000 }, total: 32000, ...over.sectionB },
  };
}

describe('renderComment', () => {
  it('shows a dash for unchanged buckets', () => {
    const md = renderComment(report(), report());
    expect(md).toContain('Client JS size');
    expect(md).toMatch(/core.*15\.0 KB.*—/s);
  });

  it('shows + delta for an increase and - for a decrease', () => {
    const baseline = report();
    const fresh = report({
      sectionA: {
        actions: { total: { gzip: 8000 }, marginalOverCore: { gzip: 4500 } },
      },
      sectionB: { buckets: { core: 20000, app: 11000 }, total: 31000 },
    });
    const md = renderComment(fresh, baseline);
    expect(md).toContain('+1.5 KB'); // actions marginal 3000 -> 4500
    expect(md).toMatch(/\*\*total\*\*.*-1\.0 KB/s); // site total 32000 -> 31000
  });

  it('marks new and removed buckets', () => {
    const baseline = report();
    const fresh = report({
      sectionA: {
        persist: { total: { gzip: 900 }, marginalOverCore: { gzip: 600 } },
      },
    });
    // Remove "loaders" from fresh to simulate a removed bucket.
    delete fresh.sectionA.loaders;
    const md = renderComment(fresh, baseline);
    expect(md).toContain('(new)');
    expect(md).toContain('(removed)');
  });

  it('does not flag size with a warning (budgets removed)', () => {
    const md = renderComment(report(), report());
    expect(md).not.toContain('⚠️');
    expect(md).not.toContain('Budgets');
  });

  it('omits the freshness footer when no meta is given', () => {
    const md = renderComment(report(), report());
    expect(md).not.toContain('Measured');
  });

  it('renders a freshness footer with short sha, timestamp, and run link', () => {
    const md = renderComment(report(), report(), {
      sha: '2af64e6d9abc123',
      generatedAt: '2026-06-02T01:36:33Z',
      runUrl: 'https://github.com/o/r/actions/runs/123',
    });
    expect(md).toContain('Measured `2af64e6d9`');
    expect(md).toContain('2026-06-02T01:36:33Z');
    expect(md).toContain('[run](https://github.com/o/r/actions/runs/123)');
  });

  it('drops missing footer fields without emitting empty separators', () => {
    const md = renderComment(report(), report(), { sha: 'deadbeefcafe' });
    expect(md).toContain('Measured `deadbeefc`');
    expect(md).not.toContain('· ');
  });
});

describe('Section C rendering', () => {
  function reportWithC(c) {
    return {
      sectionA: {
        core: { total: { gzip: 15000 }, marginalOverCore: { gzip: 15000 } },
      },
      sectionB: { buckets: { app: 1000 }, total: 1000 },
      sectionC: c,
    };
  }

  const base = reportWithC({
    'ui-core': { total: { gzip: 500 }, marginalOverUiCore: { gzip: 500 } },
    dialog: { total: { gzip: 900 }, marginalOverUiCore: { gzip: 400 } },
  });

  it('renders a Components table with ui-core total and component marginal', () => {
    const md = renderComment(base, base);
    expect(md).toContain('Components');
    expect(md).toMatch(/ui-core.*500 B/s);
    expect(md).toMatch(/dialog.*400 B/s);
  });

  it('shows a delta when a component grows', () => {
    const fresh = reportWithC({
      'ui-core': { total: { gzip: 500 }, marginalOverUiCore: { gzip: 500 } },
      dialog: { total: { gzip: 1100 }, marginalOverUiCore: { gzip: 600 } },
    });
    const md = renderComment(fresh, base);
    expect(md).toContain('+200 B'); // dialog marginal 400 -> 600
  });

  it('marks components as (new) when the baseline lacks Section C', () => {
    const baselineNoC = {
      sectionA: base.sectionA,
      sectionB: base.sectionB,
    };
    const md = renderComment(base, baselineNoC);
    expect(md).toContain('Components');
    expect(md).toContain('(new)');
  });

  it('omits the Components table entirely when fresh has no Section C', () => {
    const noC = { sectionA: base.sectionA, sectionB: base.sectionB };
    const md = renderComment(noC, noC);
    expect(md).not.toContain('### Components');
  });
});
