import { Select, Combobox, matchSubstring } from 'hono-preact-ui';
import { useState } from 'preact/hooks';
import {
  STATUSES,
  PRIORITIES,
  type TaskStatus,
  type TaskPriority,
  type User,
} from '../../demo/data.js';

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};
const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const STATUS_OPTIONS = STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));
const PRIORITY_OPTIONS = PRIORITIES.map((value) => ({
  value,
  label: PRIORITY_LABELS[value],
}));

const triggerCls =
  'flex w-full items-center rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px] text-foreground placeholder:text-muted';
const popupCls =
  'demo-popup z-50 min-w-[10rem] rounded-lg border border-border bg-background p-1 text-foreground shadow-lg';
const optionCls =
  'cursor-pointer rounded-md px-2 py-1.5 text-[12.5px] data-[highlighted]:bg-accent/10';

export function StatusSelect({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (v: TaskStatus) => void;
}) {
  return (
    <Select.Root<TaskStatus>
      value={value}
      onValueChange={(v) => onChange(v ?? value)}
    >
      <Select.Trigger class={triggerCls}>
        <Select.Value />
        <span class="ml-auto text-muted" aria-hidden>
          ▾
        </span>
      </Select.Trigger>
      <Select.Positioner>
        <Select.Popup class={popupCls} aria-label="Status">
          {STATUS_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value} class={optionCls}>
              {o.label}
            </Select.Option>
          ))}
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}

export function PrioritySelect({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (v: TaskPriority) => void;
}) {
  return (
    <Select.Root<TaskPriority>
      value={value}
      onValueChange={(v) => onChange(v ?? value)}
    >
      <Select.Trigger class={triggerCls}>
        <span
          class="mr-1.5 h-2 w-2 rounded-full"
          style={{ background: `var(--color-priority-${value})` }}
          aria-hidden
        />
        <Select.Value />
        <span class="ml-auto text-muted" aria-hidden>
          ▾
        </span>
      </Select.Trigger>
      <Select.Positioner>
        <Select.Popup class={popupCls} aria-label="Priority">
          {PRIORITY_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value} class={optionCls}>
              {o.label}
            </Select.Option>
          ))}
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}

// AssigneeCombobox dogfoods Combobox with consumer-side filtering.
// The consumer holds the typed query in state, passes it as inputValue, and
// renders only matching options. Combobox itself never filters. The domain
// value is `string | null`: null flows in as the controlled-empty value and
// flows out when Combobox.Clear (Unassign) fires.
export function AssigneeCombobox({
  users,
  value,
  onChange,
}: {
  users: User[];
  value: string | null; // user id or null (unassigned)
  onChange: (id: string | null) => void;
}) {
  const options = users.map((u) => ({ id: u.id, name: u.name }));
  const selected = options.find((o) => o.id === value);

  const [query, setQuery] = useState(selected?.name ?? '');
  const filtered = options.filter((o) => matchSubstring(o.name, query));

  return (
    <Combobox.Root<string>
      value={value}
      onValueChange={onChange}
      inputValue={query}
      onInputChange={setQuery}
      itemToString={(id) => options.find((o) => o.id === id)?.name ?? ''}
    >
      <Combobox.Anchor class="flex items-center gap-1">
        <Combobox.Input
          class={triggerCls}
          aria-label="Assignee"
          placeholder="Unassigned"
        />
        <Combobox.Clear
          class="rounded px-1 text-muted hover:bg-foreground/10"
          aria-label="Unassign"
        >
          ×
        </Combobox.Clear>
      </Combobox.Anchor>
      <Combobox.Status />
      <Combobox.Positioner>
        <Combobox.Popup class={popupCls} aria-label="Assignee">
          {filtered.map((o) => (
            <Combobox.Option key={o.id} value={o.id} class={optionCls}>
              {o.name}
            </Combobox.Option>
          ))}
          <Combobox.Empty class="px-2 py-1.5 text-[12.5px] text-muted">
            No match
          </Combobox.Empty>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
