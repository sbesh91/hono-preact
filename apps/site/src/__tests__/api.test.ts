import { describe, it, expect, beforeEach } from 'vitest';
import { resetDemoData } from '../demo/data.js';
import { __resetActivityForTesting } from '../demo/activity-stream.js';
import app from '../api.js';

beforeEach(() => {
  resetDemoData();
  __resetActivityForTesting();
});

describe('GET /api/demo/activity', () => {
  it('streams JSON activity frames as text/event-stream (reads backfill, then aborts)', async () => {
    const ctrl = new AbortController();
    const res = await app.request('/api/demo/activity', {
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let firstData: string | null = null;

    // The backfill frames are written before the first timer sleep, so they
    // arrive in the first read(s). Bound the loop so the test can't hang.
    for (let i = 0; i < 5 && firstData === null; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const m = buf.match(/^data: (.*)$/m);
      if (m) firstData = m[1];
    }
    ctrl.abort();
    await reader.cancel().catch(() => undefined);

    expect(firstData).not.toBeNull();
    const parsed = JSON.parse(firstData!);
    expect(parsed).toHaveProperty('kind');
    expect(parsed).toHaveProperty('taskId');
    expect(['inf', 'api', 'web']).toContain(parsed.projectSlug);
  });
});
