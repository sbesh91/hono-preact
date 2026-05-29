import { cloneElement, h, type ComponentChildren, type VNode } from 'preact';
import { mergeRefs } from './merge-refs.js';

type Props = Record<string, unknown>;

export type UseRenderRender =
  | VNode
  | string
  | ((props: Props) => VNode)
  | undefined;

interface UseRenderOptions {
  render?: UseRenderRender;
  defaultTag: string;
  props: Props;
  children?: ComponentChildren;
}

function joinClass(a: unknown, b: unknown): string | undefined {
  const parts: string[] = [];
  if (typeof a === 'string' && a.length > 0) parts.push(a);
  if (typeof b === 'string' && b.length > 0) parts.push(b);
  if (parts.length === 0) return undefined;
  return parts.join(' ');
}

function mergeProps(user: Props, framework: Props): Props {
  const out: Props = { ...user };
  for (const key of Object.keys(framework)) {
    if (key === 'class' || key === 'className') {
      const userClass = (user.class ?? user.className) as unknown;
      const merged = joinClass(userClass, framework[key]);
      if (merged !== undefined) out.class = merged;
      delete out.className;
    } else if (key === 'ref') {
      out.ref = mergeRefs(user.ref as never, framework.ref as never);
    } else {
      out[key] = framework[key];
    }
  }
  return out;
}

export function useRender(opts: UseRenderOptions): VNode {
  const { render, defaultTag, props, children } = opts;

  if (typeof render === 'function') {
    return render(mergeProps({}, props));
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
  return h(tag as 'div', props, children) as VNode;
}
