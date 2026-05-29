import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';

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
