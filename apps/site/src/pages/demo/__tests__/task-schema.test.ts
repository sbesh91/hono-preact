import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { PatchTaskSchema, DeleteTaskSchema } from '../task-schema.js';

describe('PatchTaskSchema', () => {
  it('accepts a status-only patch', () => {
    const r = v.safeParse(PatchTaskSchema, { taskId: 't-1', status: 'done' });
    expect(r.success).toBe(true);
  });

  it('accepts a priority-only patch', () => {
    const r = v.safeParse(PatchTaskSchema, {
      taskId: 't-1',
      priority: 'high',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const r = v.safeParse(PatchTaskSchema, {
      taskId: 't-1',
      status: 'archived',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing taskId', () => {
    const r = v.safeParse(PatchTaskSchema, { status: 'done' });
    expect(r.success).toBe(false);
  });
});

describe('DeleteTaskSchema', () => {
  it('accepts a taskId', () => {
    const r = v.safeParse(DeleteTaskSchema, { taskId: 't-1' });
    expect(r.success).toBe(true);
  });

  it('rejects an empty taskId', () => {
    const r = v.safeParse(DeleteTaskSchema, { taskId: '' });
    expect(r.success).toBe(false);
  });
});
