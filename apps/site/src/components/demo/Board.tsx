// apps/site/src/components/demo/Board.tsx
import type { FunctionComponent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useAction, useOptimistic, useOptimisticAction } from 'hono-preact';
import { toast } from 'hono-preact-ui';
import { groupTasks, STATUS_COLUMNS } from '../../demo/group-tasks.js';
import type { Task, TaskStatus, TaskPriority, User } from '../../demo/data.js';
import {
  serverActions,
  serverLoaders,
} from '../../pages/demo/project-board.server.js';
import { useBoardDrag, type ColumnRect } from '../../hooks/use-board-drag.js';
import Column from './Column.js';

type Props = { tasks: Task[]; projectSlug: string; users: User[] };

export type PatchFn = (
  taskId: string,
  patch: { status?: TaskStatus; priority?: TaskPriority }
) => void;
export type RemoveFn = (taskId: string) => void;

const Board: FunctionComponent<Props> = ({ tasks, projectSlug, users }) => {
  const patch = useOptimisticAction(serverActions.patchTask, {
    base: tasks,
    apply: (current, payload) =>
      current.map((t) =>
        t.id === payload.taskId
          ? {
              ...t,
              ...(payload.status ? { status: payload.status } : {}),
              ...(payload.priority ? { priority: payload.priority } : {}),
            }
          : t
      ),
    invalidate: [serverLoaders.default],
  });
  // Deletes ride a STANDALONE optimistic layer over the patch-adjusted list:
  // the card disappears same-frame, settle keeps it gone once the server
  // confirms, revert brings it back on failure. transition: true wraps
  // settle/revert in a view transition where supported.
  const [visibleTasks, removeOptimistically] = useOptimistic(
    patch.value,
    (current, taskId: string) => current.filter((t) => t.id !== taskId),
    { transition: true }
  );
  const del = useAction(serverActions.deleteTask, {
    invalidate: [serverLoaders.default],
  });
  const restore = useAction(serverActions.restoreTask, {
    invalidate: [serverLoaders.default],
  });

  const doPatch: PatchFn = (taskId, p) => patch.mutate({ taskId, ...p });

  const doRemove: RemoveFn = (taskId) => {
    const removed = patch.value.find((t) => t.id === taskId);
    const handle = removeOptimistically(taskId);
    void del.mutate({ taskId }).then((r) => {
      if (r.ok) {
        handle.settle();
        toast.success(`Deleted "${removed?.title ?? 'task'}"`, {
          description: 'The task and its comments are gone.',
          action: {
            label: 'Undo',
            onClick: () => {
              void restore.mutate({ taskId }).then((rr) => {
                if (!rr.ok) toast.error(rr.error.message);
              });
            },
          },
        });
      } else {
        handle.revert();
        toast.error(r.error.message);
      }
    });
  };

  const colEls = useRef<Map<string, HTMLElement>>(new Map());
  const getColumnRects = (): ColumnRect[] =>
    STATUS_COLUMNS.map((c) => {
      const el = colEls.current.get(c.status);
      const r = el?.getBoundingClientRect();
      return {
        status: c.status,
        rect: { left: r?.left ?? 0, right: r?.right ?? 0 },
      };
    });
  const drag = useBoardDrag(getColumnRects, (taskId, to) =>
    doPatch(taskId, { status: to })
  );

  const columns = groupTasks(visibleTasks);
  const userById = new Map(users.map((u) => [u.id, u] as const));

  // FLIP: when the optimistic patch reorders cards, glide each card whose slot
  // shifted from its old position to its new one. Excludes the dragged card
  // (its ghost settles separately) and cross-column movers (their flight would
  // be clipped by the board's overflow; they snap instead). `settlingId` is
  // read but kept out of the deps on purpose: it is set in the same render
  // batch as the drop's patch, so the exclusion already holds on that run, and
  // re-running when it later clears would re-measure mid-glide.
  const boardRef = useRef<HTMLDivElement>(null);
  const cardRects = useRef<Map<string, DOMRect>>(new Map());
  const flipUntil = useRef(0);
  useLayoutEffect(() => {
    const root = boardRef.current;
    if (!root) return;
    // While a glide is still running, ignore re-renders (the invalidate refetch
    // re-renders with the same positions). Re-measuring a mid-transform card
    // returns a bogus delta and restarts the transition -> jitter.
    if (performance.now() < flipUntil.current) return;

    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const prev = cardRects.current;
    const next = new Map<string, DOMRect>();
    const moved: { card: HTMLElement; dx: number; dy: number }[] = [];

    root.querySelectorAll<HTMLElement>('[data-task-id]').forEach((card) => {
      const id = card.getAttribute('data-task-id');
      if (!id) return;
      const rect = card.getBoundingClientRect();
      next.set(id, rect);
      if (reduce || id === drag.settlingId) return; // ghost handles this one
      const old = prev.get(id);
      if (!old) return; // newly mounted: nothing to glide from
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (Math.abs(dx) > 40) return; // changed columns: snap, don't fly + clip
      if (dx || dy) moved.push({ card, dx, dy });
    });
    cardRects.current = next;
    if (!moved.length) return;

    // Invert: snap each moved card back to its old position with no transition.
    for (const { card, dx, dy } of moved) {
      card.style.transition = 'none';
      card.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    void root.offsetWidth; // single reflow so the inverted offsets register
    // Play: release them to glide to the new positions.
    for (const { card } of moved) {
      card.style.transition = 'transform 200ms cubic-bezier(.2, .8, .2, 1)';
      card.style.transform = '';
    }
    flipUntil.current = performance.now() + 240; // ~transition duration + margin
  }, [visibleTasks]);

  return (
    <div ref={boardRef} class="grid grid-cols-4 gap-3 overflow-x-auto p-4">
      {columns.map((column) => (
        <Column
          key={column.status}
          column={column}
          projectSlug={projectSlug}
          userById={userById}
          onPatch={doPatch}
          onRemove={doRemove}
          registerEl={(el: HTMLElement | null) => {
            if (el) colEls.current.set(column.status, el);
          }}
          onPointerDownCard={drag.onPointerDown}
          draggingId={drag.draggingId}
          isOver={drag.overStatus === column.status}
        />
      ))}
    </div>
  );
};
Board.displayName = 'Board';
export default Board;
