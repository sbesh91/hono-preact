import { describe, it, expect, beforeEach } from 'vitest';
import { projectDigestLine } from '../digest.js';
import { resetDemoData, listProjects, listTasksForProject } from '../data.js';

describe('projectDigestLine', () => {
  beforeEach(() => resetDemoData());

  it('summarizes open counts and flags the most urgent open task', () => {
    const inf = listProjects().find((p) => p.slug === 'inf')!;
    const line = projectDigestLine(inf, listTasksForProject(inf.id));
    expect(line).toContain('Infrastructure');
    expect(line).toContain('4 open of 5');
    expect(line).toContain('Worker times out under load');
  });

  it('reports an all-done project without an urgent pick', () => {
    const legacy = listProjects().find((p) => p.slug === 'legacy')!;
    const line = projectDigestLine(legacy, listTasksForProject(legacy.id));
    expect(line).toContain('0 open of 2');
    expect(line).not.toContain('next:');
  });
});
