import {
  createContext,
  h,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import { useContext, useId } from 'preact/hooks';
import { renderElement, type RenderProp } from './use-render.js';

export interface OptionGroupContextValue {
  labelId: string;
}
export const OptionGroupContext = createContext<OptionGroupContextValue | null>(
  null
);

export type OptionGroupProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

// Return type left inferred: h(OptionGroupContext.Provider, ...) yields a VNode
// with more specific props than VNode<{}>, same pattern as Positioner.
export function OptionGroup(props: OptionGroupProps) {
  const { render, children, ...rest } = props;
  const labelId = useId();
  const node = renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, role: 'group', 'aria-labelledby': labelId },
    children,
  });
  return h(OptionGroupContext.Provider, { value: { labelId } }, node);
}

export type OptionGroupLabelProps = {
  render?: RenderProp;
  children?: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'>;

export function OptionGroupLabel(props: OptionGroupLabelProps): VNode {
  const { render, children, ...rest } = props;
  const group = useContext(OptionGroupContext);
  return renderElement({
    render,
    defaultTag: 'div',
    props: { ...rest, id: group?.labelId },
    children,
  });
}
