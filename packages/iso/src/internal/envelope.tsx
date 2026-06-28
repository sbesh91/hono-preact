import type {
  ComponentChildren,
  ComponentType,
  FunctionComponent,
  JSX,
} from 'preact';
import { h } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import type { WrapperProps } from '../page.js';
import { isBrowser } from '../is-browser.js';
import { LoaderIdContext } from './contexts.js';

/** What the `data-loader` hydration attribute carries. Discriminated + extensible. */
export type HydrationAnchor =
  | { kind: 'none' }
  | { kind: 'data'; value: unknown };

type EnvelopeProps = {
  as?: ComponentType<WrapperProps> | keyof JSX.IntrinsicElements;
  anchor: HydrationAnchor;
  children: ComponentChildren;
};

export const Envelope: FunctionComponent<EnvelopeProps> = ({
  as = 'section',
  anchor,
  children,
}) => {
  const id = useContext(LoaderIdContext);
  if (!id) throw new Error('<Envelope> must be inside a <Loader>');

  // Coerce undefined -> null so JSON.stringify(undefined) never reaches the wire.
  const dataLoader =
    anchor.kind === 'data' ? JSON.stringify(anchor.value ?? null) : 'null';

  // De-orphan our SSR node on hydration. When a lazy nested-route subtree
  // suspends mid-hydration, preact-iso's vendored suspense leaves a sibling's
  // SSR node orphaned (a #4442-class duplicate) while the client mounts a fresh
  // node; its Router only reclaims its OWN first DOM node (`this.__v.__e`), so a
  // non-first orphan survives. Two nodes then share our `useId`, and on the next
  // navigation they collide on a shared `view-transition-name`. Because `useId`
  // is globally unique, any node carrying our id that ISN'T the one we control
  // is that orphan; drop it in a layout effect (before paint, and before any
  // view-transition capture). Runs once per mount; a no-op when nothing dupes.
  const liveRef = useRef<Element | null>(null);
  // A ref callback (wide param) rather than a typed RefObject: the `as` string
  // is the full `keyof JSX.IntrinsicElements` union, and a typed ref over that
  // union is "too complex to represent". A callback accepting `Element | null`
  // is assignable to every element's RefCallback (param contravariance).
  const setLive = (node: Element | null) => {
    liveRef.current = node;
  };
  useLayoutEffect(() => {
    if (!isBrowser()) return;
    const live = liveRef.current;
    if (!live) return;
    const dupes = live.ownerDocument.querySelectorAll(`[id="${id}"]`);
    if (dupes.length < 2) return;
    dupes.forEach((node) => {
      if (node !== live) node.remove();
    });
  }, [id]);

  if (typeof as === 'string') {
    // `h()` rather than JSX: a `ref` on a `<Tag>` whose type is the full
    // `keyof JSX.IntrinsicElements` union makes that union "too complex to
    // represent". `h(string, props)` types props loosely and sidesteps it.
    return h(as, { id, 'data-loader': dataLoader, ref: setLive }, children);
  }
  const Wrapper = as;
  return (
    <Wrapper id={id} data-loader={dataLoader}>
      {children}
    </Wrapper>
  );
};
