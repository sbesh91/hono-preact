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

// Patching a task: one action drives both drag moves and priority changes,
// so both fields are optional; `taskId` is always required.
export const PatchTaskSchema = v.object({
  taskId: v.pipe(v.string(), v.minLength(1)),
  status: v.optional(v.picklist(STATUSES, 'Status must be a known column')),
  priority: v.optional(
    v.picklist(PRIORITIES, 'Priority must be a known level')
  ),
});

// Deleting a task: just the id.
export const DeleteTaskSchema = v.object({
  taskId: v.pipe(v.string(), v.minLength(1)),
});

// Route-param shapes. paramsSchema failures respond 404 through the
// framework (LoaderValidationError on the client), so a malformed URL never
// reaches the loader body; a well-formed unknown id still runs the loader,
// which denies 404 itself.
const projectSlug = v.pipe(
  v.string(),
  v.regex(/^[a-z][a-z0-9-]*$/, 'Not a project slug')
);
const taskIdShape = v.pipe(v.string(), v.regex(/^t-\d+$/, 'Not a task id'));

export const ProjectRouteParamsSchema = v.object({ projectId: projectSlug });
export const TaskRouteParamsSchema = v.object({
  projectId: projectSlug,
  taskId: taskIdShape,
});

// Board filter: searchSchema validates and defaults ?priority=. An unknown
// value responds 400 through the framework (LoaderValidationError on the
// client); v.object strips any undeclared key from the schema's output, so
// unrelated query keys are dropped from the loader's searchParams view, even
// though the request URL itself is unaffected.
export const BoardSearchSchema = v.object({
  priority: v.optional(v.picklist(['all', ...PRIORITIES]), 'all'),
});
