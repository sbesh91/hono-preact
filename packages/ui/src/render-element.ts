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

// Compose a user handler with a framework handler, user-first: this matches
// how a part chains its own onX prop with its internal logic (the part calls
// the caller's handler, then does its own work). Both sides run
// unconditionally; neither can veto the other by, say, calling
// preventDefault (parts that need that guard read event.defaultPrevented
// themselves).
function composeHandlers(
  user: (...args: unknown[]) => unknown,
  framework: (...args: unknown[]) => unknown
): (...args: unknown[]) => void {
  return (...args) => {
    user(...args);
    framework(...args);
  };
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

// Framework props win over user props, except `class`/`className` (joined),
// `ref` (merged so both the user ref and our ref fire), and function props
// that collide on both sides (composed user-first instead of the framework
// handler silently replacing the user's).
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
      const userVal = user[key];
      const fwVal = framework[key];
      if (isCallable(userVal) && isCallable(fwVal)) {
        out[key] = composeHandlers(userVal, fwVal);
      } else {
        out[key] = fwVal;
      }
    }
  }
  return out;
}

// A part is an interactive trigger - its own behavior depends on the
// resolved DOM element being focusable - when its framework props wire a
// click, key, or focus handler. Presentational parts (Title, Description,
// Separator, GroupLabel, Anchor, ...) never carry these, so this stays false
// for them; it only trips for parts like Tooltip.Trigger (onFocus opens the
// tooltip) or a button-flavored action (onClick) whose contract requires the
// element to actually receive focus/clicks. That keeps the check narrow
// enough to avoid false positives on non-interactive parts.
const TRIGGER_HANDLER_KEYS = ['onClick', 'onKeyDown', 'onFocus'] as const;

function isInteractiveTrigger(props: Props): boolean {
  return TRIGGER_HANDLER_KEYS.some((key) => typeof props[key] === 'function');
}

const FOCUSABLE_TAG = /^(button|a|input|select|textarea|summary)$/i;

function isFocusable(el: HTMLElement): boolean {
  return (
    FOCUSABLE_TAG.test(el.tagName) ||
    el.tabIndex >= 0 ||
    el.hasAttribute('tabindex')
  );
}

const warnedTriggerElements = new WeakSet<HTMLElement>();

function warnIfNotFocusable(el: HTMLElement): void {
  if (warnedTriggerElements.has(el) || isFocusable(el)) return;
  warnedTriggerElements.add(el);
  console.warn(
    `renderElement: <${el.tagName.toLowerCase()}> is used as an interactive trigger ` +
      '(it receives a click, key, or focus handler) but is not focusable. ' +
      'Render it as a <button> (or another natively focusable element), or add tabindex={0}.'
  );
}

function triggerRef(el: HTMLElement | null): void {
  if (el) warnIfNotFocusable(el);
}

// Dev-only: append the focusability check to whatever ref is already going
// out for this element, once per resolved node (WeakSet dedupes remounts of
// the same element within a session).
function withTriggerWarn(ref: unknown, props: Props): unknown {
  if (!import.meta.env.DEV || !isInteractiveTrigger(props)) return ref;
  return mergeRefs(
    ref as Parameters<typeof mergeRefs>[0],
    triggerRef as Parameters<typeof mergeRefs>[0]
  );
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
    merged.ref = withTriggerWarn(merged.ref, props);
    const mergedChildren: ComponentChildren =
      children !== undefined
        ? children
        : ((render.props as { children?: ComponentChildren })?.children ??
          null);
    return cloneElement(render, merged, mergedChildren);
  }
  const tag = typeof render === 'string' ? render : defaultTag;
  const tagProps: Props = isInteractiveTrigger(props)
    ? { ...props, ref: withTriggerWarn(props.ref, props) }
    : props;
  return h(tag, tagProps as JSX.HTMLAttributes, children) as VNode;
}
