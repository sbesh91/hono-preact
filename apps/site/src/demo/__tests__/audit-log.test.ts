import { describe, it, expect, beforeEach } from 'vitest';
import { recordAudit, recentAudit, resetAudit } from '../audit-log.js';
import { streamAuditLine } from '../stream-audit.js';

describe('audit log', () => {
  beforeEach(() => resetAudit());

  it('returns newest entries first', () => {
    recordAudit('first');
    recordAudit('second');
    const lines = recentAudit();
    expect(lines[0]).toContain('second');
    expect(lines[1]).toContain('first');
  });

  it('caps the buffer at 50 entries', () => {
    for (let i = 0; i < 60; i++) recordAudit(`entry ${i}`);
    const lines = recentAudit(100);
    expect(lines).toHaveLength(50);
    expect(lines[0]).toContain('entry 59');
    expect(lines.at(-1)).toContain('entry 10');
  });

  it('formats stream lifecycle lines', () => {
    expect(streamAuditLine('start', 'shell.activity')).toBe(
      'stream start shell.activity'
    );
    expect(streamAuditLine('end', 'shell.activity', 7)).toBe(
      'stream end shell.activity (7 chunks)'
    );
    expect(streamAuditLine('abort', 'tasks.comments', 2)).toBe(
      'stream abort tasks.comments (2 chunks)'
    );
  });
});
