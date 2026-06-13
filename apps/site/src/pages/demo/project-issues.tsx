import { definePage, Form, useFormStatus } from 'hono-preact';
import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { serverLoaders, serverActions } from './project-issues.server.js';
import IssueRow from '../../components/demo/IssueRow.js';

const issuesLoader = serverLoaders.default;

const ProjectIssuesPage: FunctionComponent = () => {
  const data = issuesLoader.useData();
  const [showForm, setShowForm] = useState(false);
  const { pending: creating } = useFormStatus(serverActions.createIssue);

  if (!data) return <p>Unknown project.</p>;
  const { project, issues } = data;

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">{project.name} · Issues</h2>
        <button
          type="button"
          class="bg-accent text-accent-foreground px-3 py-1 text-sm hover:bg-accent-hover"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : 'New issue'}
        </button>
      </div>

      {showForm && (
        <Form
          action={serverActions.createIssue}
          onSuccess={() => setShowForm(false)}
          class="border p-3 space-y-2"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <input
            name="title"
            placeholder="Issue title"
            required
            class="block w-full border px-2 py-1"
          />
          <textarea
            name="body"
            placeholder="Describe what's happening"
            rows={3}
            class="block w-full border px-2 py-1"
          />
          <button
            type="submit"
            class="bg-accent text-accent-foreground px-3 py-1 text-sm hover:bg-accent-hover"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </Form>
      )}

      <ul class="space-y-2">
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} projectSlug={project.slug} />
        ))}
      </ul>
    </div>
  );
};
ProjectIssuesPage.displayName = 'ProjectIssuesPage';

const ProjectIssuesView = issuesLoader.View(() => <ProjectIssuesPage />, {
  fallback: <p>Loading issues…</p>,
});

export default definePage(ProjectIssuesView);
