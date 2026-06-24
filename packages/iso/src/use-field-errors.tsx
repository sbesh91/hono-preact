import type { VNode } from 'preact';
import { useContext } from 'preact/hooks';
import {
  renderElement,
  type RenderElementRender,
} from './internal/render-element.js';
import {
  FieldErrorsContext,
  FieldErrorPrefixContext,
  fieldErrorId,
  type FieldErrorsMap,
} from './internal/field-errors-context.js';

/**
 * Read the enclosing `<Form>`'s merged field errors (client pre-validation plus
 * any server `deny(422)` issues), keyed by field name (the issue path joined by
 * `.`). Returns `{}` outside a `<Form>`.
 */
export function useFieldErrors(): FieldErrorsMap {
  return useContext(FieldErrorsContext);
}

/** ARIA props to spread onto a field control so screen readers announce and
 * associate its error. */
export interface FieldErrorAriaProps {
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * Returns ARIA props to spread onto a field control (`<input>`/`<select>`/...)
 * so it is programmatically associated with its `<FieldError>`:
 *
 * ```tsx
 * <input name="title" {...useFieldErrorProps('title')} />
 * <FieldError name="title" />
 * ```
 *
 * When the field has an error this returns `aria-invalid` and an
 * `aria-describedby` pointing at the `<FieldError>` element's id; when the
 * field is valid (or used outside a `<Form>`) it returns an empty object, so
 * the attributes are absent rather than stale.
 */
export function useFieldErrorProps(name: string): FieldErrorAriaProps {
  const errors = useContext(FieldErrorsContext);
  const prefix = useContext(FieldErrorPrefixContext);
  const hasError = (errors[name]?.length ?? 0) > 0;
  if (!hasError) return {};
  return {
    'aria-invalid': true,
    'aria-describedby': fieldErrorId(prefix, name),
  };
}

export interface FieldErrorProps {
  /** Field name (the issue path joined by `.`). Pass `""` for form-level errors. */
  name: string;
  /** Convenience class for the default element; merged onto a custom `render`. */
  class?: string;
  /**
   * Customize the rendered element via the framework render-element convention:
   * a tag name (`'p'`), a VNode to merge the framework props into
   * (`<MyError />`), or a render function `(props) => VNode`. The framework
   * always applies `data-field-error`, `role="alert"`, and an `id` (referenced
   * by `useFieldErrorProps`), and the first message is the element's children.
   * The function form receives the props but not the message; read
   * `useFieldErrors()` for full control. Defaults to a `<span>`.
   */
  render?: RenderElementRender;
}

/**
 * Render the first error message for `name`, or nothing when the field is valid.
 * A thin convenience wrapper over `useFieldErrors`; use the hook directly for
 * richer rendering (e.g. listing every message for a field).
 */
export function FieldError(props: FieldErrorProps): VNode | null {
  const errors = useFieldErrors();
  const prefix = useContext(FieldErrorPrefixContext);
  const message = errors[props.name]?.[0];
  if (!message) return null;
  return renderElement({
    render: props.render,
    defaultTag: 'span',
    props: {
      class: props.class,
      id: fieldErrorId(prefix, props.name),
      'data-field-error': props.name,
      role: 'alert',
    },
    children: message,
  });
}
