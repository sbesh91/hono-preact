// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Toaster } from '../toast/toaster.js';
import { toastStore } from '../toast/toast-store.js';

describe('<Toaster> SSR', () => {
  it('renders a stable empty region with no toast() calls and no crash', () => {
    expect(toastStore.toasts).toHaveLength(0);
    const html = renderToString(
      <Toaster label="Notifications">{(t) => <div>{t.title}</div>}</Toaster>
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Notifications"');
  });
});
