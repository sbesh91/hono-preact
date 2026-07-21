import type { ComponentChildren, FunctionComponent, JSX } from 'preact';
import { h } from 'preact';
import { useCallback, useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { isBrowser } from '../is-browser.js';
import { LoaderIdContext } from './contexts.js';

/** What the `data-loader` hydration attribute carries. Discriminated + extensible. */
export type HydrationAnchor =
  | { kind: 'none' }
  | { kind: 'data'; value: unknown }
  | { kind: 'deny'; message: string };

type EnvelopeProps = {
  // Intrinsic elements only. A custom-component wrapper cannot forward the ref
  // the de-orphan effect below needs to identify its own DOM node, so the
  // effect would silently no-op; restricting `as` to an intrinsic keeps that
  // effect always correct. (Page's `Wrapper` prop is the public custom-wrapper
  // knob; `Envelope` is loader-internal.)
  as?: keyof JSX.IntrinsicElements;
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

  // A deny anchor rides a SEPARATE attribute: the client reads it BEFORE
  // `data-loader`, seeds a coldError, and skips the fetch. A denied loader
  // writes NO `data-loader` (so `getPreloadedData` reports absent for it).
  const denyAttr =
    anchor.kind === 'deny'
      ? JSON.stringify({ message: anchor.message })
      : undefined;
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
  // useCallback keeps its identity stable so Preact attaches the ref once rather
  // than detaching/reattaching on every re-render.
  const setLive = useCallback((node: Element | null) => {
    liveRef.current = node;
  }, []);
  useLayoutEffect(() => {
    if (!isBrowser()) return;
    const live = liveRef.current;
    if (!live) return;
    // An id selector (`#id`) hits the document's id index; an `[id="..."]`
    // attribute selector would force a full-tree walk on every loader mount.
    const dupes = live.ownerDocument.querySelectorAll(`#${CSS.escape(id)}`);
    if (dupes.length < 2) return;
    dupes.forEach((node) => {
      if (node !== live) node.remove();
    });
  }, [id]);

  // `h()` rather than JSX: a `ref` on a `<Tag>` whose type is the full
  // `keyof JSX.IntrinsicElements` union makes that union "too complex to
  // represent". `h(string, props)` types props loosely and sidesteps it.
  const attrs: Record<string, unknown> =
    anchor.kind === 'deny'
      ? { id, 'data-loader-deny': denyAttr, ref: setLive }
      : { id, 'data-loader': dataLoader, ref: setLive };
  return h(as, attrs, children);
};
