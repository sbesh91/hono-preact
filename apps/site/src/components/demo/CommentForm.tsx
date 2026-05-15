import { Form, useAction } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { serverActions, serverLoaders } from '../../pages/demo/issue.server.js';

type Props = { issueId: string; onAdded?: () => void };

const CommentForm: FunctionComponent<Props> = ({ issueId, onAdded }) => {
  // Bump `formKey` after a successful submit to remount the <Form> and reset
  // the textarea. Cleaner than ref-forwarding through the wrapper.
  const [formKey, setFormKey] = useState(0);

  const { mutate, pending } = useAction(serverActions.addComment, {
    invalidate: [serverLoaders.comments, serverLoaders.activity],
    onSuccess: () => {
      setFormKey((k) => k + 1);
      onAdded?.();
    },
  });

  return (
    <Form
      key={formKey}
      mutate={mutate}
      pending={pending}
      class="space-y-2"
    >
      <input type="hidden" name="issueId" value={issueId} />
      <textarea
        name="body"
        rows={3}
        required
        placeholder="Add a comment"
        class="block w-full border px-2 py-1"
      />
      <button type="submit" class="bg-blue-600 text-white px-3 py-1 text-sm">
        {pending ? 'Posting…' : 'Comment'}
      </button>
    </Form>
  );
};
CommentForm.displayName = 'CommentForm';

export default CommentForm;
