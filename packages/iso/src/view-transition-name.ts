import type { ComponentChildren, VNode } from 'preact';
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';
import { mergeRefs } from './internal/merge-refs.js';
import {
  renderElement,
  type RenderElementRender,
} from './internal/render-element.js';

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
      nodeRef.current.style.removeProperty('view-transition-name');
    }
    if (isStyledElement(node)) {
      nodeRef.current = node;
      applyCssProp(node, 'view-transition-name', nameRef.current);
    } else {
      nodeRef.current = null;
    }
  }, []);
}

// Dev-only diagnostic: a `view-transition-class` is inert unless the same
// element also carries a `view-transition-name` (its own, or one supplied by
// the <ViewTransitionName> name+groupClass pairing). Warn once so the silent
// no-op is debuggable. The hook is only ever called behind `import.meta.env.DEV`,
// a build-time constant, so a consumer's production bundle strips the call (and
// this hook with it) and it costs nothing there. Runs client-only:
// useLayoutEffect never fires during SSR, where getComputedStyle does not exist.
function useInertClassWarning(
  nodeRef: { current: NodeRef | null },
  value: string | null
): void {
  // Warn at most once for a genuinely inert class.
  const warnedRef = useRef(false);
  // Latches once the element is confirmed to carry a view-transition-name, so a
  // correctly-paired element stops re-reading getComputedStyle on later value
  // changes.
  const checkedRef = useRef(false);
  useLayoutEffect(() => {
    if (checkedRef.current || warnedRef.current) return;
    const node = nodeRef.current;
    // An empty class applies nothing (applyCssProp removes the property for
    // both null and ''), so it is never inert; skip the check and the warning.
    if (node == null || value == null || value === '') return;
    // Reads inline and stylesheet-set names alike, so the paired
    // ViewTransitionName (inline) and an element with its own CSS name both
    // count as present.
    const name = getComputedStyle(node)
      .getPropertyValue('view-transition-name')
      .trim();
    if (name === '' || name === 'none') {
      warnedRef.current = true;
      console.warn(
        `[hono-preact] view-transition-class ${JSON.stringify(value)} is inert: ` +
          'the element has no view-transition-name, so it joins no view ' +
          'transition group. Pair the class with a name via <ViewTransitionName> ' +
          '(name plus groupClass), or set a view-transition-name on the element.'
      );
    } else {
      checkedRef.current = true;
    }
  }, [value]);
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

  if (import.meta.env.DEV) useInertClassWarning(nodeRef, value);

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
  render?: RenderElementRender;
  children?: ComponentChildren;
}

export function ViewTransitionName(props: ViewTransitionNameProps): VNode {
  const nameRef = useViewTransitionName(props.name);
  const classRef = useViewTransitionClass(props.groupClass);
  const ref = mergeRefs<Element>(nameRef, classRef);
  return renderElement({
    render: props.render,
    defaultTag: 'div',
    props: { ref },
    children: props.children,
  });
}

export interface ViewTransitionGroupProps {
  class: string | string[];
  render?: RenderElementRender;
  children?: ComponentChildren;
}

export function ViewTransitionGroup(props: ViewTransitionGroupProps): VNode {
  const classRef = useViewTransitionClass(props.class);
  return renderElement({
    render: props.render,
    defaultTag: 'div',
    props: { ref: classRef },
    children: props.children,
  });
}
