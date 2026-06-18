import { describe, it, expect } from 'vitest';
import { dropTargetFromPoint } from '../use-board-drag.js';
import type { TaskStatus } from '../../demo/data.js';

const rects: { status: TaskStatus; rect: { left: number; right: number } }[] = [
  { status: 'backlog', rect: { left: 0, right: 100 } },
  { status: 'in_progress', rect: { left: 100, right: 200 } },
  { status: 'in_review', rect: { left: 200, right: 300 } },
  { status: 'done', rect: { left: 300, right: 400 } },
];

describe('dropTargetFromPoint', () => {
  it('returns the column containing x', () => {
    expect(dropTargetFromPoint(rects, 150)).toBe('in_progress');
    expect(dropTargetFromPoint(rects, 350)).toBe('done');
  });
  it('clamps to the nearest edge column when out of range', () => {
    expect(dropTargetFromPoint(rects, -20)).toBe('backlog');
    expect(dropTargetFromPoint(rects, 999)).toBe('done');
  });
});
