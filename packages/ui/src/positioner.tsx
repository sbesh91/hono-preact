import { h, type ComponentChildren, type JSX, type RefObject } from 'preact';
import { useMemo } from 'preact/hooks';
import { renderElement, type RenderProp } from './render-element.js';
import { usePositioner } from './use-positioner.js';
import type { Side, Align, ClientRectGetter } from './use-position.js';
import { PositionerContext } from './positioner-context.js';

export type PositionerProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  floatingRef: RefObject<HTMLElement>;
  side: Side;
  align: Align;
  offset: number;
  getAnchorRect?: ClientRectGetter;
  mount: 'unmount' | 'hidden';
  render?: RenderProp<{ side: Side; align: Align }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

// The shared overlay-positioning surface: runs usePositioner, publishes the
// resolved position + arrow ref via PositionerContext, and renders the
// positioned element. Each component's XPositioner is a thin wrapper that reads
// its own context and forwards the resolved values here.
// Return type left inferred: h(PositionerContext.Provider, ...) yields a VNode
// with more specific props than VNode<{}> (matches the XPositioner precedent).
export function Positioner(props: PositionerProps) {
  const {
    open,
    anchorRef,
    floatingRef,
    side,
    align,
    offset,
    getAnchorRect,
    mount,
    render,
    children,
    ...rest
  } = props;
  const { isPresent, positionerProps, state, position, arrowRef } =
    usePositioner({
      open,
      anchorRef,
      floatingRef,
      side,
      align,
      offset,
      getAnchorRect,
      mount,
    });
  const positionerValue = useMemo(() => ({ position, arrowRef }), [position]);
  if (mount === 'unmount' && !isPresent) return null;
  return h(
    PositionerContext.Provider,
    { value: positionerValue },
    renderElement<{ side: Side; align: Align }>({
      render,
      defaultTag: 'div',
      props: { ...rest, ...positionerProps },
      state,
      children,
    })
  );
}
