import type { ComponentChildren, VNode } from 'preact';
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';
import { mergeRefs } from './internal/merge-refs.js';
import { useRender, type UseRenderRender } from './internal/use-render.js';
import {
  __isColdTransitionActive,
  __deferTransitionName,
} from './internal/route-change.js';

type NodeRef = HTMLElement | SVGElement;

function isStyledElement(node: Element | null): node is NodeRef {
  return (
    node !== null && (node instanceof HTMLElement || node instanceof SVGElement)
  );
}

function applyCssProp(
  node: NodeRef | null,
  property: string,
  value: string | null | undefined
): void {
  if (!node) return;
  if (value == null || value === '') {
    node.style.removeProperty(property);
  } else {
    node.style.setProperty(property, value);
  }
}

export function useViewTransitionName(
  name: string | null | undefined
): (node: Element | null) => void {
  const nodeRef = useRef<NodeRef | null>(null);
  const nameRef = useRef<string | null | undefined>(name);
  nameRef.current = name;

  // Sync when name changes on a node we already hold.
  useLayoutEffect(() => {
    applyCssProp(nodeRef.current, 'view-transition-name', name);
  }, [name]);

  // Stable ref callback: applies on attach, clears the previous node on swap.
  return useCallback((node: Element | null) => {
    if (nodeRef.current && nodeRef.current !== node) {
      // On a real element swap (node !== null) always clear the name from the
      // node we no longer hold. On a detach (node === null) keep the name ONLY
      // while a cold transition is in flight, so the outgoing element can serve
      // as a morph source while preact-iso retains it as `prev` (preact removes
      // the node, and its inline name, when it drops prev). Outside a cold
      // transition, clear on detach as usual so a name can't linger on a
      // retained node.
      if (node !== null || !__isColdTransitionActive()) {
        nodeRef.current.style.removeProperty('view-transition-name');
      }
    }
    if (isStyledElement(node)) {
      nodeRef.current = node;
      const name = nameRef.current;
      if (name != null && name !== '' && __isColdTransitionActive()) {
        // A cold navigation's view transition has already captured the old
        // snapshot. Defer naming this incoming element until the transition
        // swaps, so it appears only in the new snapshot (and can't collide with
        // a retained source name in the old snapshot).
        __deferTransitionName(() =>
          applyCssProp(node, 'view-transition-name', name)
        );
      } else {
        applyCssProp(node, 'view-transition-name', name);
      }
    } else {
      nodeRef.current = null;
    }
  }, []);
}

export function useViewTransitionClass(
  cls: string | string[] | null | undefined
): (node: Element | null) => void {
  const value = cls == null ? null : Array.isArray(cls) ? cls.join(' ') : cls;

  const nodeRef = useRef<NodeRef | null>(null);
  const valueRef = useRef<string | null>(value);
  valueRef.current = value;

  useLayoutEffect(() => {
    applyCssProp(nodeRef.current, 'view-transition-class', value);
  }, [value]);

  return useCallback((node: Element | null) => {
    if (nodeRef.current && nodeRef.current !== node) {
      nodeRef.current.style.removeProperty('view-transition-class');
    }
    if (isStyledElement(node)) {
      nodeRef.current = node;
      applyCssProp(node, 'view-transition-class', valueRef.current);
    } else {
      nodeRef.current = null;
    }
  }, []);
}

export interface ViewTransitionNameProps {
  name: string | null | undefined;
  groupClass?: string | string[];
  render?: UseRenderRender;
  children?: ComponentChildren;
}

export function ViewTransitionName(props: ViewTransitionNameProps): VNode {
  const nameRef = useViewTransitionName(props.name);
  const classRef = useViewTransitionClass(props.groupClass);
  const ref = mergeRefs<Element>(nameRef, classRef);
  return useRender({
    render: props.render,
    defaultTag: 'div',
    props: { ref },
    children: props.children,
  });
}

export interface ViewTransitionGroupProps {
  class: string | string[];
  render?: UseRenderRender;
  children?: ComponentChildren;
}

export function ViewTransitionGroup(props: ViewTransitionGroupProps): VNode {
  const classRef = useViewTransitionClass(props.class);
  return useRender({
    render: props.render,
    defaultTag: 'div',
    props: { ref: classRef },
    children: props.children,
  });
}
