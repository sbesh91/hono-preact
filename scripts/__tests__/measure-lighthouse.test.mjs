import { describe, it, expect } from 'vitest';
import {
  pageKey,
  parseManifest,
  extractReport,
  historyRow,
  badgePayload,
  resolveOutputPaths,
} from '../measure-lighthouse.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One representative + one non-representative run for '/', plus '/demo'.
function fixture() {
  const manifest = [
    {
      url: 'http://localhost:8788/',
      isRepresentativeRun: false,
      jsonPath: '/x/lhr-ignored.json',
      summary: { performance: 0.5, accessibility: 1, 'best-practices': 1, seo: 1 },
    },
    {
      url: 'http://localhost:8788/',
      isRepresentativeRun: true,
      jsonPath: '/x/lhr-home.json',
      summary: { performance: 0.975, accessibility: 1, 'best-practices': 1, seo: 0.92 },
    },
    {
      url: 'http://localhost:8788/demo',
      isRepresentativeRun: true,
      jsonPath: '/x/lhr-demo.json',
      summary: { performance: 0.85, accessibility: 0.95, 'best-practices': 1, seo: 1 },
    },
  ];
  const lhrs = {
    '/x/lhr-home.json': {
      audits: {
        'largest-contentful-paint': { numericValue: 1234.5 },
        'total-blocking-time': { numericValue: 0 },
        'cumulative-layout-shift': { numericValue: 0.0123 },
      },
    },
    '/x/lhr-demo.json': {
      audits: {
        'largest-contentful-paint': { numericValue: 2200 },
        'total-blocking-time': { numericValue: 50 },
        'cumulative-layout-shift': { numericValue: 0 },
      },
    },
  };
  const links = { 'http://localhost:8788/': 'https://storage.googleapis.com/report-home' };
  return { manifest, loadLhr: (p) => lhrs[p], links };
}

describe('pageKey', () => {
  it('reduces a collect URL to its pathname', () => {
    expect(pageKey('http://localhost:8788/docs/quick-start')).toBe('/docs/quick-start');
    expect(pageKey('http://localhost:8788/')).toBe('/');
  });
});

describe('parseManifest', () => {
  it('keeps only representative runs and rounds scores to 0-100', () => {
    const { manifest, loadLhr, links } = fixture();
    const report = parseManifest(manifest, loadLhr, links);
    expect(report.version).toBe(1);
    expect(Object.keys(report.pages)).toEqual(['/', '/demo']);
    expect(report.pages['/'].scores).toEqual({
      performance: 98, // round(0.975 * 100) = 98 (the 0.5 non-representative run is dropped)
      accessibility: 100,
      bestPractices: 100,
      seo: 92,
    });
  });

  it('reads headline metrics from the referenced LHR', () => {
    const { manifest, loadLhr, links } = fixture();
    const report = parseManifest(manifest, loadLhr, links);
    expect(report.pages['/'].metrics).toEqual({ lcp: 1235, tbt: 0, cls: 0.012 });
  });

  it('attaches a hosted report URL only when links has one', () => {
    const { manifest, loadLhr, links } = fixture();
    const report = parseManifest(manifest, loadLhr, links);
    expect(report.pages['/'].reportUrl).toBe('https://storage.googleapis.com/report-home');
    expect(report.pages['/demo'].reportUrl).toBeUndefined();
  });
});

describe('extractReport (IO wrapper)', () => {
  it('reads manifest.json + LHRs + links.json from a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lh-'));
    const homeLhr = join(dir, 'lhr-home.json');
    writeFileSync(
      homeLhr,
      JSON.stringify({
        audits: {
          'largest-contentful-paint': { numericValue: 900 },
          'total-blocking-time': { numericValue: 0 },
          'cumulative-layout-shift': { numericValue: 0 },
        },
      })
    );
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          url: 'http://localhost:8788/',
          isRepresentativeRun: true,
          jsonPath: homeLhr,
          summary: { performance: 1, accessibility: 1, 'best-practices': 1, seo: 1 },
        },
      ])
    );
    writeFileSync(
      join(dir, 'links.json'),
      JSON.stringify({ 'http://localhost:8788/': 'https://example/report' })
    );
    const report = extractReport(dir);
    expect(report.pages['/'].scores.performance).toBe(100);
    expect(report.pages['/'].reportUrl).toBe('https://example/report');
  });

  it('works without links.json (reportUrl omitted)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lh-'));
    const lhr = join(dir, 'lhr.json');
    writeFileSync(
      lhr,
      JSON.stringify({
        audits: {
          'largest-contentful-paint': { numericValue: 1000 },
          'total-blocking-time': { numericValue: 10 },
          'cumulative-layout-shift': { numericValue: 0.01 },
        },
      })
    );
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          url: 'http://localhost:8788/demo',
          isRepresentativeRun: true,
          jsonPath: lhr,
          summary: { performance: 0.8, accessibility: 1, 'best-practices': 1, seo: 1 },
        },
      ])
    );
    const report = extractReport(dir);
    expect(report.pages['/demo'].reportUrl).toBeUndefined();
    expect(report.pages['/demo'].scores.performance).toBe(80);
  });
});

describe('historyRow', () => {
  it('keeps scores + metrics per page, drops reportUrl, stamps sha/date', () => {
    const report = {
      version: 1,
      pages: {
        '/': {
          scores: { performance: 98, accessibility: 100, bestPractices: 100, seo: 92 },
          metrics: { lcp: 1235, tbt: 0, cls: 0.012 },
          reportUrl: 'https://example/report',
        },
      },
    };
    const row = historyRow(report, 'abc123', '2026-06-15T00:00:00Z');
    expect(row).toEqual({
      sha: 'abc123',
      date: '2026-06-15T00:00:00Z',
      pages: {
        '/': {
          scores: { performance: 98, accessibility: 100, bestPractices: 100, seo: 92 },
          metrics: { lcp: 1235, tbt: 0, cls: 0.012 },
        },
      },
    });
  });
});

describe('badgePayload', () => {
  it('uses the home Performance score with Lighthouse colour banding', () => {
    const mk = (performance) => ({ version: 1, pages: { '/': { scores: { performance } } } });
    expect(badgePayload(mk(98))).toEqual({
      schemaVersion: 1,
      label: 'lighthouse',
      message: '98',
      color: 'brightgreen',
    });
    expect(badgePayload(mk(72)).color).toBe('orange');
    expect(badgePayload(mk(40)).color).toBe('red');
    // Exact Lighthouse banding boundaries (>=90 green, >=50 orange, else red).
    expect(badgePayload(mk(90)).color).toBe('brightgreen');
    expect(badgePayload(mk(89)).color).toBe('orange');
    expect(badgePayload(mk(50)).color).toBe('orange');
    expect(badgePayload(mk(49)).color).toBe('red');
  });

  it('falls back to 0/red when the home page is missing', () => {
    expect(badgePayload({ version: 1, pages: {} })).toEqual({
      schemaVersion: 1,
      label: 'lighthouse',
      message: '0',
      color: 'red',
    });
  });
});

describe('resolveOutputPaths', () => {
  it('defaults all three files to root', () => {
    expect(resolveOutputPaths({ root: '/repo' })).toEqual({
      report: '/repo/lighthouse-report.json',
      history: '/repo/lighthouse-history.jsonl',
      badge: '/repo/lighthouse-badge.json',
    });
  });

  it('bases all three under outDir when given', () => {
    expect(resolveOutputPaths({ root: '/repo', outDir: '/wt' })).toEqual({
      report: '/wt/lighthouse-report.json',
      history: '/wt/lighthouse-history.jsonl',
      badge: '/wt/lighthouse-badge.json',
    });
  });

  it('lets out override only the report path', () => {
    const p = resolveOutputPaths({ root: '/repo', outDir: '/wt', out: '/tmp/r.json' });
    expect(p.report).toBe('/tmp/r.json');
    expect(p.history).toBe('/wt/lighthouse-history.jsonl');
    expect(p.badge).toBe('/wt/lighthouse-badge.json');
  });
});
