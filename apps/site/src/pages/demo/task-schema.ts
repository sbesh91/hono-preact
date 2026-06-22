import * as v from 'valibot';
import { PRIORITIES, STATUSES } from '../../demo/data.js';

export const NewTaskSchema = v.object({
  projectId: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.trim(), v.minLength(1, 'Title is required')),
  body: v.fallback(v.pipe(v.string(), v.trim()), ''),
  priority: v.picklist(PRIORITIES, 'Priority is required'),
  status: v.picklist(STATUSES, 'Status is required'),
  // The form sends '' for unassigned; coerce to null.
  assigneeId: v.pipe(
    v.fallback(v.string(), ''),
    v.transform((s) => (s === '' ? null : s))
  ),
});

export type NewTaskInput = v.InferOutput<typeof NewTaskSchema>;
