// apps/site/src/components/demo/NewTaskDialog.tsx
import { Dialog } from 'hono-preact-ui';
import { Form, useFormStatus } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import {
  serverActions,
  serverLoaders,
} from '../../pages/demo/project-board.server.js';
import { PrioritySelect, StatusSelect, AssigneeCombobox } from './pickers.js';
import type { TaskStatus, TaskPriority, User } from '../../demo/data.js';

type Props = { projectId: string; users: User[] };

const NewTaskDialog: FunctionComponent<Props> = ({ projectId, users }) => {
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('backlog');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const { pending } = useFormStatus(serverActions.createTask);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger class="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-foreground hover:bg-accent-hover">
        + New task
      </Dialog.Trigger>
      <Dialog.Popup class="m-auto w-[380px] rounded-2xl border border-border bg-background p-5 shadow-2xl backdrop:bg-foreground/40">
        <Dialog.Title class="text-base font-bold">New task</Dialog.Title>
        <Dialog.Description class="mb-3.5 text-[12px] text-muted">
          Adds to this project.
        </Dialog.Description>
        <Form
          action={serverActions.createTask}
          invalidate={[serverLoaders.default]}
          onSuccess={() => setOpen(false)}
          class="space-y-2.5"
        >
          <input type="hidden" name="projectId" value={projectId} />
          {/* pickers are controlled; mirror their values into hidden inputs so
              the Form payload carries them */}
          <input type="hidden" name="priority" value={priority} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="assigneeId" value={assigneeId ?? ''} />

          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold">Title</span>
            <input
              name="title"
              required
              placeholder="Short summary"
              class="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px]"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold">
              Description
            </span>
            <textarea
              name="body"
              rows={3}
              placeholder="What's happening, and why it matters..."
              class="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px]"
            />
          </label>
          <div class="grid grid-cols-2 gap-2.5">
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold">Priority</span>
              <PrioritySelect value={priority} onChange={setPriority} />
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold">Status</span>
              <StatusSelect value={status} onChange={setStatus} />
            </label>
          </div>
          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold">Assignee</span>
            <AssigneeCombobox
              users={users}
              value={assigneeId}
              onChange={setAssigneeId}
            />
          </label>
          <div class="mt-4 flex justify-end gap-2">
            <Dialog.Close class="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold">
              Cancel
            </Dialog.Close>
            <button
              type="submit"
              class="rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-foreground hover:bg-accent-hover"
            >
              {pending ? 'Creating...' : 'Create task'}
            </button>
          </div>
        </Form>
      </Dialog.Popup>
    </Dialog.Root>
  );
};
NewTaskDialog.displayName = 'NewTaskDialog';
export default NewTaskDialog;
