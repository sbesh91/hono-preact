import { describe, it, expect } from 'vitest';
import { renderComment } from '../render-size-comment.mjs';

const cfg = { BUDGETS: { core: 16000, 'site:total': 40000 } };

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
    const md = renderComment(report(), report(), cfg);
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
    const md = renderComment(fresh, baseline, cfg);
    expect(md).toContain('+1.5 KB'); // actions marginal 3000 -> 4500
    expect(md).toMatch(/\*\*total\*\*.*-1\.0 KB/s); // site total 32000 -> 31000
  });

  it('flags a bucket over budget with a warning', () => {
    const fresh = report({
      sectionA: {
        core: { total: { gzip: 18000 }, marginalOverCore: { gzip: 18000 } },
      },
    });
    const md = renderComment(fresh, report(), cfg);
    expect(md).toContain('⚠️');
    expect(md).toContain('18.0 KB / 16.0 KB');
    expect(md).not.toContain('20.0 KB / ');
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
    const md = renderComment(fresh, baseline, cfg);
    expect(md).toContain('(new)');
    expect(md).toContain('(removed)');
  });

  it('omits the freshness footer when no meta is given', () => {
    const md = renderComment(report(), report(), cfg);
    expect(md).not.toContain('Measured');
  });

  it('renders a freshness footer with short sha, timestamp, and run link', () => {
    const md = renderComment(report(), report(), cfg, {
      sha: '2af64e6d9abc123',
      generatedAt: '2026-06-02T01:36:33Z',
      runUrl: 'https://github.com/o/r/actions/runs/123',
    });
    expect(md).toContain('Measured `2af64e6d9`');
    expect(md).toContain('2026-06-02T01:36:33Z');
    expect(md).toContain('[run](https://github.com/o/r/actions/runs/123)');
  });

  it('drops missing footer fields without emitting empty separators', () => {
    const md = renderComment(report(), report(), cfg, { sha: 'deadbeefcafe' });
    expect(md).toContain('Measured `deadbeefc`');
    expect(md).not.toContain('· ');
  });
});
