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

// Adding a comment: the `<Form>` posts FormData, so both fields arrive as
// strings (no coercion needed). The schema also trims the body server-side.
export const AddCommentSchema = v.object({
  taskId: v.pipe(v.string(), v.minLength(1)),
  body: v.pipe(v.string(), v.trim()),
});

// Moving a task: `status` must be one of the known statuses. Passing the schema
// as `input` lets `route.action` infer the payload type; no manual generics.
export const SetStatusSchema = v.object({
  taskId: v.pipe(v.string(), v.minLength(1)),
  status: v.picklist(STATUSES, 'Status is required'),
});
