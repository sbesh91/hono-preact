import { describe, it, expect } from 'vitest';
import { renderComment } from '../render-lighthouse-comment.mjs';

function page(scores = {}, metrics = {}, reportUrl) {
  const p = {
    scores: { performance: 95, accessibility: 100, bestPractices: 100, seo: 100, ...scores },
    metrics: { lcp: 1200, tbt: 0, cls: 0, ...metrics },
  };
  if (reportUrl) p.reportUrl = reportUrl;
  return p;
}

function report(pages) {
  return { version: 1, pages };
}

describe('renderComment', () => {
  it('renders a per-page table and a dash for unchanged scores', () => {
    const r = report({ '/': page() });
    const md = renderComment(r, r);
    expect(md).toContain('<!-- lighthouse -->');
    expect(md).toContain('## Lighthouse');
    expect(md).toContain('`/`');
    expect(md).toMatch(/Performance.*95\/100.*—/s);
  });

  it('shows a signed delta for a regression and an improvement', () => {
    const baseline = report({ '/': page({ performance: 95 }) });
    const fresh = report({ '/': page({ performance: 91 }) });
    expect(renderComment(fresh, baseline)).toMatch(/Performance.*91\/100.*-4/s);

    const up = report({ '/': page({ performance: 99 }) });
    expect(renderComment(up, baseline)).toMatch(/Performance.*99\/100.*\+4/s);
  });

  it('marks a new page and a removed page', () => {
    const baseline = report({ '/': page(), '/demo': page() });
    const fresh = report({ '/': page(), '/docs/quick-start': page() });
    const md = renderComment(fresh, baseline);
    expect(md).toContain('(new)'); // /docs/quick-start scores are new
    expect(md).toContain('(removed)'); // /demo present in baseline, gone in fresh
  });

  it('renders a metrics sub-line for each fresh page', () => {
    const r = report({ '/': page({}, { lcp: 1500, tbt: 12, cls: 0.03 }) });
    const md = renderComment(r, r);
    expect(md).toContain('LCP 1500 ms');
    expect(md).toContain('TBT 12 ms');
    expect(md).toContain('CLS 0.03');
  });

  it('links the page heading to the hosted report when present', () => {
    const r = report({ '/': page({}, {}, 'https://storage/report-home') });
    expect(renderComment(r, r)).toContain('### [`/`](https://storage/report-home)');
  });

  it('omits the freshness footer when no meta is given', () => {
    const r = report({ '/': page() });
    expect(renderComment(r, r)).not.toContain('Measured');
  });

  it('renders a freshness footer with short sha, timestamp, and run link', () => {
    const r = report({ '/': page() });
    const md = renderComment(r, r, {
      sha: '2af64e6d9abc123',
      generatedAt: '2026-06-15T01:36:33Z',
      runUrl: 'https://github.com/o/r/actions/runs/123',
    });
    expect(md).toContain('Measured `2af64e6d9`');
    expect(md).toContain('2026-06-15T01:36:33Z');
    expect(md).toContain('[run](https://github.com/o/r/actions/runs/123)');
  });
});
