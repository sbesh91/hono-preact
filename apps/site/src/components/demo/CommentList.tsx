import type { FunctionComponent } from 'preact';
import type { Comment, User } from '../../demo/data.js';

type WithAuthor = Comment & { author: User | null };
type Props = { comments: WithAuthor[] };

const CommentList: FunctionComponent<Props> = ({ comments }) => {
  if (comments.length === 0) {
    return (
      <p class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
        No comments yet. Start the conversation.
      </p>
    );
  }
  return (
    <ul class="space-y-2.5">
      {comments.map((c) => {
        const name = c.author?.name ?? 'someone';
        return (
          <li
            key={c.id}
            class="flex gap-2.5 rounded-lg border border-border bg-background p-3"
          >
            <span
              class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground"
              aria-hidden
            >
              {name.charAt(0).toUpperCase()}
            </span>
            <div class="min-w-0 flex-1">
              <header class="flex items-baseline gap-2">
                <span class="text-sm font-medium text-foreground">{name}</span>
                <time class="text-xs text-muted">
                  {new Date(c.createdAt).toLocaleString()}
                </time>
              </header>
              <p class="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                {c.body}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
CommentList.displayName = 'CommentList';

export default CommentList;
