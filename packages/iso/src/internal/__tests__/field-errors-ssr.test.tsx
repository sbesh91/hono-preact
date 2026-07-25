// @vitest-environment node
// Whole-branch review Important finding: the per-field granular error store
// (Phase 3 Task 4) is only ever exercised under happy-dom. `<Form>` seeds the
// store via a synchronous `fieldErrorStore.setAll(fieldErrors)` call in its
// render body specifically so the first render -- including a true SSR render
// with no DOM globals -- already has the field's signal populated before any
// descendant reads it. This renders `<Form>` + `<FieldError>` to a STRING
// with `preact-render-to-string` under Node (no `window`/`document`), through
// the real `ActionResultContext` seeding path (mirroring the
// "shows server field errors from ActionResultContext without any client
// submit" case in `form-validation.test.tsx`, and the render-to-string
// pattern in `signal-roster-ssr.test.tsx`), and asserts the seeded server
// error is present in the server HTML -- proving SSR and the client's first
// render agree, with no hydration mismatch.
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Form } from '../../form.js';
import { FieldError } from '../../use-field-errors.js';
import { defineAction } from '../../action.js';
import { ActionResultContext } from '../../action-result-context.js';
import { VALIDATION_ISSUES_KEY } from '../contract.js';

const schema = {
  '~standard': {
    version: 1 as const,
    vendor: 'test',
    validate: (v: unknown) => {
      const title = (v as { title?: unknown }).title;
      return typeof title === 'string' && title.length > 0
        ? { value: { title } }
        : { issues: [{ message: 'Title is required', path: ['title'] }] };
    },
  },
};

const serverDenyAction = defineAction(async () => ({ ok: true }), {
  input: schema,
  __module: 'pages/test.server',
  __action: 'serverDeny',
});

describe('field-error store under preact-render-to-string', () => {
  it('seeds the per-field store from ActionResultContext before first render, with no window/document', () => {
    expect(typeof window).toBe('undefined');

    const ctxValue = {
      module: 'pages/test.server',
      action: 'serverDeny',
      kind: 'deny' as const,
      status: 422,
      message: 'Validation failed',
      data: {
        [VALIDATION_ISSUES_KEY]: [
          { path: ['title'], message: 'Title is required' },
        ],
      },
      submittedPayload: {},
    };

    const html = renderToString(
      <ActionResultContext.Provider value={ctxValue}>
        <Form action={serverDenyAction} schema={schema}>
          <input name="title" />
          <FieldError name="title" />
          <button type="submit">Save</button>
        </Form>
      </ActionResultContext.Provider>
    );

    expect(html).toContain('Title is required');
  });
});
