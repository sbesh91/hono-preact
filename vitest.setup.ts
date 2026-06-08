import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

// The UI components require the Popover API (no runtime feature-detection); they
// call `showPopover()` to promote overlays to the top layer. happy-dom (v20)
// does not implement it, so stub the methods in the test env. happy-dom does not
// apply the popover UA hiding either, so the elements stay queryable; no-ops are
// sufficient to exercise the same code path without throwing. Guarded so the
// node test environment (no HTMLElement) is unaffected.
const popoverProto = globalThis.HTMLElement?.prototype as
  | (HTMLElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
      togglePopover?: () => boolean;
    })
  | undefined;
if (popoverProto && typeof popoverProto.showPopover !== 'function') {
  popoverProto.showPopover = function () {};
  popoverProto.hidePopover = function () {};
  popoverProto.togglePopover = function () {
    return false;
  };
}

// Filter known-spurious happy-dom error noise from the test runner output.
// Without this, every render that includes the SSR'd `<script
// src="virtual:hono-preact/client">` tag (most page tests) and every
// `<link rel="stylesheet" href="/styles.css">` triggers a multi-line
// DOMException stack trace that masks any legitimate uncaught rejection.
//
// We match against happy-dom's own error text (e.g. "JavaScript file
// loading is disabled") which is specific enough that real DOMExceptions
// with different messages still surface normally. If you find this filter
// hiding a real bug, add a more specific predicate rather than removing
// the filter wholesale.
const SILENCED_PATTERNS = [
  'JavaScript file loading is disabled',
  'Failed to execute "fetch()" on "Window"',
  'NetworkError when attempting to fetch resource',
];

function shouldSilence(args: readonly unknown[]): boolean {
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) {
        return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      }
      return '';
    })
    .join(' ');
  return SILENCED_PATTERNS.some((p) => text.includes(p));
}

const ORIGINAL_CONSOLE_ERROR = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (shouldSilence(args)) return;
  ORIGINAL_CONSOLE_ERROR(...args);
};

// KNOWN LIMITATION: happy-dom emits stylesheet/script load failures
// through its internal `browserFrame.page.console.error`, not Node's
// global console. That channel is not reachable from a setup file, so
// a handful of DOMException stack traces still print on test runs.
// They're stable, identifiable, and don't affect pass/fail. If you
// see them in CI output, look past them at the test summary.

// Vitest's reporter still prints orphan unhandled rejections from happy-dom
// despite `dangerouslyIgnoreUnhandledErrors`. Vitest's own listener
// short-circuits when ANY other `unhandledRejection` listener is registered
// (its catchError checks `processListeners(event).length > 1`), so installing
// our handler silences its reporting. We then filter ourselves: known-spurious
// happy-dom rejections are dropped; everything else is logged through the
// original console.error so real bugs in test code stay visible. Real test
// failures still surface via assertions; this only governs orphan rejections.
process.on('unhandledRejection', (reason) => {
  if (shouldSilence([reason])) return;
  ORIGINAL_CONSOLE_ERROR('Unhandled Rejection in test code:', reason);
});
process.on('uncaughtException', (err) => {
  if (shouldSilence([err])) return;
  ORIGINAL_CONSOLE_ERROR('Uncaught Exception in test code:', err);
});
