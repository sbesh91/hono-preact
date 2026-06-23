// Shared View Transitions helpers for the overlay primitives (Dialog, Popover).
// Each wraps its show/hide DOM mutation in document.startViewTransition so the
// browser tweens the before/after snapshots, and hands a view-transition-name
// between the trigger and the popup so the popup morphs out of (and back into)
// the trigger.

// A Document that may expose the View Transitions API. Declared as an optional
// member so a plain Document is assignable without a cast; the runtime guard in
// runViewTransition is what actually decides whether to use it.
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown;
};

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// Run `update` (the show/hide DOM change plus its view-transition-name handoff)
// inside a View Transition when the platform supports it and the user has not
// asked for reduced motion; otherwise apply it directly so the popup still
// opens/closes, just without the animation. `update` may be async: when it
// returns a promise the browser waits for it to settle before capturing the
// "after" snapshot (the Popover uses this to wait for floating-ui to position
// the popup before the snapshot is taken).
export function runViewTransition(update: () => void | Promise<void>): void {
  const doc: ViewTransitionDocument = document;
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    void update();
    return;
  }
  doc.startViewTransition(update);
}
