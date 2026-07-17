import { describe, it, expect, beforeEach } from 'vitest';
import app from '../api.js';
import { resetDemoData } from '../demo/data.js';

describe('demo api', () => {
  beforeEach(() => resetDemoData());

  it('serves workspace health as JSON', async () => {
    const res = await app.request('/api/demo/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.projects).toBe(4);
    expect(body.tasks).toBe(14);
  });

  it('404s outside its namespace', async () => {
    const res = await app.request('/api/demo/nope');
    expect(res.status).toBe(404);
  });
});
