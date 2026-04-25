# File Upload Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow action payloads to include `File` objects from `<input type="file">`, using `multipart/form-data` transport so binary data is transmitted correctly.

**Architecture:** Two transport paths share the `/__actions` endpoint. When the payload contains `File` objects (detected in `useAction`) or a form has file inputs (detected in `Form`), the client sends `multipart/form-data` with `__module` and `__action` fields embedded in the form data. `actionsHandler` detects the content-type and parses form data instead of JSON, extracting `__module`/`__action` from the fields and building the payload from the remainder.

**Tech Stack:** TypeScript, `@hono-preact/iso`, `@hono-preact/server`, vitest, Web `FormData` API, Hono `c.req.formData()`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `packages/server/src/actions-handler.ts` | **Modify** | Parse `multipart/form-data` alongside existing JSON path |
| `packages/iso/src/action.ts` | **Modify** | Detect `File` in payload; send FormData instead of JSON |
| `packages/iso/src/form.tsx` | **Modify** | Detect file inputs; append `__module`/`__action` and send FormData |
| `packages/server/src/__tests__/actions-handler.test.ts` | **Modify** | Add multipart tests |

---

### Task 1: Multipart parsing in `actionsHandler`

**Files:**
- Modify: `packages/server/src/actions-handler.ts`
- Modify: `packages/server/src/__tests__/actions-handler.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/__tests__/actions-handler.test.ts`:

```ts
function postFormData(app: Hono, formData: FormData) {
  return app.request('http://localhost/__actions', {
    method: 'POST',
    body: formData,
  });
}

describe('actionsHandler — multipart/form-data', () => {
  it('dispatches action from multipart form data with __module and __action fields', async () => {
    const uploadFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { upload: uploadFn } },
    });

    const fd = new FormData();
    fd.append('__module', 'movies');
    fd.append('__action', 'upload');
    fd.append('title', 'Dune');

    const res = await postFormData(app, fd);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [, payload] = uploadFn.mock.calls[0];
    expect(payload.title).toBe('Dune');
  });

  it('surfaces File objects in the action payload', async () => {
    const uploadFn = vi.fn().mockResolvedValue({ stored: true });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { upload: uploadFn } },
    });

    const fd = new FormData();
    fd.append('__module', 'movies');
    fd.append('__action', 'upload');
    fd.append('poster', new File(['<binary>'], 'poster.jpg', { type: 'image/jpeg' }));

    const res = await postFormData(app, fd);
    expect(res.status).toBe(200);
    const [, payload] = uploadFn.mock.calls[0];
    expect(payload.poster).toBeInstanceOf(File);
    expect((payload.poster as File).name).toBe('poster.jpg');
  });

  it('returns 400 when __module or __action is missing from form data', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { upload: vi.fn() } },
    });
    const fd = new FormData();
    fd.append('title', 'Dune');

    const res = await postFormData(app, fd);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('__module');
  });

  it('collects repeated form field names into an array', async () => {
    const uploadFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { upload: uploadFn } },
    });

    const fd = new FormData();
    fd.append('__module', 'movies');
    fd.append('__action', 'upload');
    fd.append('tag', 'sci-fi');
    fd.append('tag', 'drama');

    await postFormData(app, fd);
    const [, payload] = uploadFn.mock.calls[0];
    expect(payload.tag).toEqual(['sci-fi', 'drama']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
vitest run packages/server/src/__tests__/actions-handler.test.ts
```

Expected: FAIL — all 4 new multipart tests fail (actionsHandler only handles JSON)

- [ ] **Step 3: Refactor request parsing in `actionsHandler`**

In `packages/server/src/actions-handler.ts`, replace the existing JSON parsing block:

```ts
let body: { module: unknown; action: unknown; payload: unknown };
try {
  body = await c.req.json();
} catch {
  return c.json({ error: 'Invalid JSON body' }, 400);
}

const { module, action, payload } = body;
if (typeof module !== 'string' || typeof action !== 'string') {
  return c.json({ error: 'Request body must include string fields: module, action' }, 400);
}
```

with:

```ts
let module: string;
let action: string;
let payload: unknown;

const contentType = c.req.header('Content-Type') ?? '';
if (contentType.startsWith('multipart/form-data')) {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'Invalid form data' }, 400);
  }

  const rawModule = formData.get('__module');
  const rawAction = formData.get('__action');
  if (typeof rawModule !== 'string' || typeof rawAction !== 'string') {
    return c.json({ error: 'Form data must include __module and __action fields' }, 400);
  }

  module = rawModule;
  action = rawAction;

  const payloadObj: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [key, value] of formData.entries()) {
    if (key === '__module' || key === '__action') continue;
    const existing = payloadObj[key];
    if (existing !== undefined) {
      payloadObj[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      payloadObj[key] = value;
    }
  }
  payload = payloadObj;
} else {
  let body: { module: unknown; action: unknown; payload: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { module: m, action: a, payload: p } = body;
  if (typeof m !== 'string' || typeof a !== 'string') {
    return c.json({ error: 'Request body must include string fields: module, action' }, 400);
  }
  module = m;
  action = a;
  payload = p;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
vitest run packages/server/src/__tests__/actions-handler.test.ts
```

Expected: PASS (all existing + 4 new tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/actions-handler.ts packages/server/src/__tests__/actions-handler.test.ts
git commit -m "feat(server): actionsHandler handles multipart/form-data for file uploads"
```

---

### Task 2: File detection in `useAction`

**Files:**
- Modify: `packages/iso/src/action.ts`

- [ ] **Step 1: Add `hasFileValues` helper and update `mutate` in `useAction`**

In `packages/iso/src/action.ts`, add this helper before `useAction`:

```ts
function hasFileValues(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  return Object.values(payload as Record<string, unknown>).some(
    (v) => typeof File !== 'undefined' && v instanceof File
  );
}
```

Inside the `mutate` callback, replace the existing `fetch` call:

```ts
const response = await fetch('/__actions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    module: (currentStub as unknown as { __module: string }).__module,
    action: (currentStub as unknown as { __action: string }).__action,
    payload,
  }),
});
```

with:

```ts
const stub = currentStub as unknown as { __module: string; __action: string };
let response: Response;
if (hasFileValues(payload)) {
  const fd = new FormData();
  fd.append('__module', stub.__module);
  fd.append('__action', stub.__action);
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    fd.append(key, value as string | File);
  }
  response = await fetch('/__actions', { method: 'POST', body: fd });
} else {
  response = await fetch('/__actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: stub.__module, action: stub.__action, payload }),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @hono-preact/iso build
```

Expected: exit 0, no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/action.ts
git commit -m "feat(iso): useAction sends FormData when payload contains File objects"
```

---

### Task 3: File detection in `Form`

**Files:**
- Modify: `packages/iso/src/form.tsx`

- [ ] **Step 1: Update `handleSubmit` to detect file inputs**

In `packages/iso/src/form.tsx`, replace the `handleSubmit` function body with:

```ts
const handleSubmit = (e: Event) => {
  e.preventDefault();
  const formEl = e.target as HTMLFormElement;
  const formData = new FormData(formEl);
  const hasFiles = [...formData.values()].some((v) => v instanceof File);

  if (fieldsetRef.current) {
    fieldsetRef.current.disabled = true;
  }

  const payload = Object.fromEntries(formData.entries()) as TPayload;
  let snapshot: unknown;
  if (onMutate) {
    snapshot = onMutate(payload);
  }

  const stub = action as unknown as { __module: string; __action: string };
  let requestInit: RequestInit;
  if (hasFiles) {
    formData.append('__module', stub.__module);
    formData.append('__action', stub.__action);
    requestInit = { method: 'POST', body: formData };
  } else {
    requestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: stub.__module, action: stub.__action, payload }),
    };
  }

  fetch('/__actions', requestInit)
    .then(async (response) => {
      if (fieldsetRef.current) {
        fieldsetRef.current.disabled = false;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          (JSON.parse(text) as { error?: string }).error ??
            `Action failed with status ${response.status}`
        );
      }
      const text = await response.text();
      const result = JSON.parse(text) as TResult;
      onSuccess?.(result);
      if (invalidate === 'auto') {
        reloadCtx?.reload();
      }
    })
    .catch((err) => {
      if (fieldsetRef.current) {
        fieldsetRef.current.disabled = false;
      }
      const e = err instanceof Error ? err : new Error(String(err));
      onError?.(e, snapshot);
    });
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @hono-preact/iso build
```

Expected: exit 0, no type errors

- [ ] **Step 3: Run full test suite**

```bash
vitest run
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/form.tsx
git commit -m "feat(iso): Form detects file inputs and sends FormData for file uploads"
```

---

## Usage Example

```ts
// movies.server.ts
export const serverActions = {
  uploadPoster: defineAction<{ movieId: string; poster: File }, { url: string }>(
    async (_ctx, { movieId, poster }) => {
      const url = await uploadToStorage(movieId, poster);
      return { url };
    }
  ),
};
```

```tsx
// movies.tsx
<Form
  action={serverActions.uploadPoster}
  invalidate="auto"
  onSuccess={({ url }) => setPosterUrl(url)}
>
  <input type="hidden" name="movieId" value={movie.id} />
  <input type="file" name="poster" accept="image/*" />
  <button type="submit">Upload Poster</button>
</Form>
```
