import { Fragment } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import type { ReadonlySignal } from '@preact/signals';

export type ShowProps<C> = {
  /** A reactive condition. `<Show>` re-renders when it changes. */
  when: ReadonlySignal<C>;
  /** Rendered when `when.value` is falsy. Defaults to nothing. */
  fallback?: ComponentChildren;
  /** Rendered when truthy. A function child receives the narrowed truthy value. */
  children: ComponentChildren | ((value: NonNullable<C>) => ComponentChildren);
};

// A component boundary for the function-child form. Running the child render
// inside this component (via the thunk) means a signal read in it subscribes
// THIS boundary, not the parent <Show>, so a child-internal signal re-renders
// only this subtree.
function ShowItem({ render }: { render: () => ComponentChildren }): VNode {
  return <Fragment>{render()}</Fragment>;
}

/**
 * Conditional render bound to a signal: shows `children` when `when.value` is
 * truthy, else `fallback`. A function child receives the narrowed truthy value
 * and runs inside its own component boundary, so its signal reads re-render that
 * subtree alone rather than the whole `<Show>`.
 */
export function Show<C>({ when, fallback, children }: ShowProps<C>): VNode {
  const value = when.value; // subscribes <Show> to the condition signal
  if (!value) {
    return <Fragment>{fallback ?? null}</Fragment>;
  }
  if (typeof children === 'function') {
    return <ShowItem render={() => children(value)} />;
  }
  return <Fragment>{children}</Fragment>;
}
