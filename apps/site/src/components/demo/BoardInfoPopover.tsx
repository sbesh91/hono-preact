// apps/site/src/components/demo/BoardInfoPopover.tsx
import { Popover } from 'hono-preact-ui';
import type { FunctionComponent } from 'preact';

export const BoardInfoPopover: FunctionComponent = () => (
  <Popover.Root side="bottom" align="end">
    <Popover.Trigger
      aria-label="About this board"
      class="grid h-7 w-7 place-items-center rounded-full border border-border text-xs font-bold text-muted hover:text-foreground"
    >
      ?
    </Popover.Trigger>
    <Popover.Positioner class="z-50">
      <Popover.Popup class="demo-popup w-72 rounded-xl border border-border bg-background p-4 shadow-subtle">
        <Popover.Title class="text-sm font-semibold text-foreground">
          What this board exercises
        </Popover.Title>
        <Popover.Description class="mt-1 text-xs leading-relaxed text-muted">
          Server-filtered search params, optimistic drag and delete with undo, a
          deliberately slow loader behind a timeout, and a route-bound
          draft-preview socket on every task page.
        </Popover.Description>
        <Popover.Close class="mt-3 text-xs font-medium underline">
          Got it
        </Popover.Close>
      </Popover.Popup>
    </Popover.Positioner>
  </Popover.Root>
);
