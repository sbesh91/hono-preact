import { type ComponentChildren, type JSX, type VNode } from 'preact';
import { renderElement, type RenderProp } from './use-render.js';
import type { Side } from './use-position.js';
import { usePositionerContext } from './positioner-context.js';

export type ArrowProps = {
  render?: RenderProp<{ side: Side }>;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

// One Arrow for every overlay. Reads the resolved position from the enclosing
// Positioner (via PositionerContext) and attaches the ref floating-ui measures.
export function Arrow(props: ArrowProps): VNode {
  const { render, children, ...rest } = props;
  const { position, arrowRef } = usePositionerContext();
  const { side, arrowX, arrowY } = position;
  return renderElement<{ side: Side }>({
    render,
    defaultTag: 'div',
    props: {
      ...rest,
      ref: arrowRef,
      'data-side': side,
      style: {
        position: 'absolute',
        left: arrowX != null ? `${arrowX}px` : undefined,
        top: arrowY != null ? `${arrowY}px` : undefined,
      },
    },
    state: { side },
    children,
  });
}
