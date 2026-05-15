import type { FunctionComponent } from 'preact';
import type { Comment, User } from '../../demo/data.js';

type WithAuthor = Comment & { author: User | null };
type Props = { comments: WithAuthor[] };

const CommentList: FunctionComponent<Props> = ({ comments }) => {
  if (comments.length === 0) {
    return <p class="text-sm text-gray-600">No comments yet.</p>;
  }
  return (
    <ul class="space-y-3">
      {comments.map((c) => (
        <li key={c.id} class="border-l-2 pl-3">
          <header class="text-xs text-gray-700">
            <strong>{c.author?.name ?? 'someone'}</strong>{' '}
            <time>{new Date(c.createdAt).toLocaleString()}</time>
          </header>
          <p class="text-sm whitespace-pre-wrap">{c.body}</p>
        </li>
      ))}
    </ul>
  );
};
CommentList.displayName = 'CommentList';

export default CommentList;
