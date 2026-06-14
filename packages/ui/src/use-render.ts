import {
  cloneElement,
  h,
  type ComponentChildren,
  type JSX,
  type VNode,
} from 'preact';
import { mergeRefs } from './merge-refs.js';

type Props = Record<string, unknown>;

// A render override for a compound part: a VNode (element to clone), a string
// (tag name), a function called with the merged framework props and the
// part's `state`, or undefined (use the default tag).
export type RenderProp<State = Record<never, never>> =
  | VNode
  | string
  | ((props: Props, state: State) => VNode)
  | undefined;

interface RenderElementOptions<State> {
  render?: RenderProp<State>;
  defaultTag: string;
  props: Props; // framework-controlled props (ref, aria-*, data-*, handlers)
  state?: State; // passed to the function form
  children?: ComponentChildren;
}

function joinClass(a: unknown, b: unknown): string | undefined {
  const parts: string[] = [];
  if (typeof a === 'string' && a.length > 0) parts.push(a);
  if (typeof b === 'string' && b.length > 0) parts.push(b);
  if (parts.length === 0) return undefined;
  return parts.join(' ');
}

// Framework props win over user props, except `class`/`className` (joined) and
// `ref` (merged so both the user ref and our ref fire).
function mergeProps(user: Props, framework: Props): Props {
  const out: Props = { ...user };
  for (const key of Object.keys(framework)) {
    if (key === 'class' || key === 'className') {
      const userClass = (user.class ?? user.className) as unknown;
      const merged = joinClass(userClass, framework[key]);
      if (merged !== undefined) out.class = merged;
      delete out.className;
    } else if (key === 'ref') {
      out.ref = mergeRefs(
        user.ref as Parameters<typeof mergeRefs>[0],
        framework.ref as Parameters<typeof mergeRefs>[0]
      );
    } else {
      out[key] = framework[key];
    }
  }
  return out;
}

export function renderElement<State = Record<never, never>>(
  opts: RenderElementOptions<State>
): VNode {
  const { render, defaultTag, props, state, children } = opts;

  if (typeof render === 'function') {
    return render(mergeProps({}, props), state as State);
  }
  if (render && typeof render === 'object' && 'type' in render) {
    const merged = mergeProps((render.props ?? {}) as Props, props);
    const mergedChildren: ComponentChildren =
      children !== undefined
        ? children
        : ((render.props as { children?: ComponentChildren })?.children ??
          null);
    return cloneElement(render, merged, mergedChildren);
  }
  const tag = typeof render === 'string' ? render : defaultTag;
  return h(tag, props as JSX.HTMLAttributes, children) as VNode;
}
