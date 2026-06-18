import { Select, Combobox, matchSubstring } from 'hono-preact-ui';
import { useState } from 'preact/hooks';
import type { TaskStatus, TaskPriority, User } from '../../demo/data.js';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
];
const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

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
      onValueChange={(v) =>
        onChange(Array.isArray(v) ? (v[0] ?? value) : v)
      }
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
      onValueChange={(v) =>
        onChange(Array.isArray(v) ? (v[0] ?? value) : v)
      }
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
// renders only matching options. Combobox itself never filters.
export function AssigneeCombobox({
  users,
  value,
  onChange,
}: {
  users: User[];
  value: string | null; // user id or null (unassigned)
  onChange: (id: string | null) => void;
}) {
  const options = [
    { id: '', name: 'Unassigned' },
    ...users.map((u) => ({ id: u.id, name: u.name })),
  ];
  const selected = options.find((o) => o.id === (value ?? '')) ?? options[0];

  const [query, setQuery] = useState(selected.name);
  const filtered = options.filter((o) => matchSubstring(o.name, query));

  return (
    <Combobox.Root<string>
      value={value ?? ''}
      onValueChange={(v) => {
        const id = Array.isArray(v) ? (v[0] ?? '') : v;
        onChange(id || null);
      }}
      inputValue={query}
      onInputChange={setQuery}
      itemToString={(id) => options.find((o) => o.id === id)?.name ?? ''}
    >
      <Combobox.Input
        class={triggerCls}
        aria-label="Assignee"
        placeholder="Search assignee..."
      />
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
