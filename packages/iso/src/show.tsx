import { Fragment } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import type { ReadonlyReactive } from './internal/reactive.js';

export type ShowProps<C> = {
  /** A reactive condition. `<Show>` re-renders when it changes. */
  when: ReadonlyReactive<C>;
  /** Rendered when `when.value` is falsy. Defaults to nothing. */
  fallback?: ComponentChildren;
  /** Rendered when truthy. A function child receives the narrowed truthy value. */
  children: ComponentChildren | ((value: NonNullable<C>) => ComponentChildren);
};

/**
 * Conditional render bound to a signal: shows `children` when `when.value` is
 * truthy, else `fallback`. A function child receives the narrowed truthy value.
 */
export function Show<C>({ when, fallback, children }: ShowProps<C>): VNode {
  const value = when.value; // subscribes <Show> to the condition signal
  if (!value) {
    return <Fragment>{fallback ?? null}</Fragment>;
  }
  return (
    <Fragment>
      {typeof children === 'function' ? children(value) : children}
    </Fragment>
  );
}
