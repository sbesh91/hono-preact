/**
 * Compat-free Suspense.
 *
 * A faithful port of `preact/compat`'s `suspense.js` that imports ONLY from
 * `preact` and never loads `preact/compat`. The goal is to stop running compat's
 * module side-effects (its global `options` patches for className/htmlFor
 * mapping, event normalization, etc.) just to get a Suspense boundary that
 * adopts SSR content on hydration.
 *
 * WHY THIS WORKS WITHOUT COMPAT
 * Preact CORE already routes a thrown thenable to a parent boundary: in
 * `options._catchError`, when the thrown value is a Promise, core walks the
 * vnode `_parent` chain looking for a component whose `_childDidSuspend` hook is
 * defined and calls it. Compat's Suspense is "merely" the component that
 * implements `_childDidSuspend` (plus the bookkeeping to detach/restore the
 * suspended subtree and re-render on resolve). So a class component implementing
 * that hook runs on stock core WITHOUT the rest of compat.
 *
 * THE MANGLED-NAME PROBLEM (the spike's central finding)
 * Preact ships a MINIFIED dist whose private property names are mangled per its
 * `mangle.json` (`_catchError` -> `__e`, `_component` -> `__c`, `_children` ->
 * `__k`, `_flags` -> `__u`, and so on). `preact/compat` works against those
 * mangled names because compat is BUILT with the same mangle map (its own source
 * uses the long names and the build rewrites them).
 *
 * `packages/iso` builds with plain `tsc` (no minify, no mangle), so whatever
 * property name we write in source is the name used at runtime. Writing
 * `options._catchError` would read `undefined` against the shipped, mangled
 * preact. We must reference the MANGLED names directly. That couples this module
 * to preact's internal mangle map (stable across all of 10.x, verified identical
 * in 10.29.1 and 10.29.2). See the spike report for the full mapping and risk
 * analysis.
 */
import { Component, createElement, Fragment, options } from 'preact';
import type { ComponentChildren, ComponentClass } from 'preact';

const MODE_HYDRATE = 1 << 5;

/**
 * Mangled internal shape of a preact VNode (names match the shipped dist; the
 * trailing comment is the unmangled source name from preact's mangle.json).
 */
interface InternalVNode {
  __?: InternalVNode | null; // _parent
  __c?: InternalComponent | null; // _component
  __e?: unknown; // _dom
  __k?: (InternalVNode | null)[] | null; // _children
  __v?: unknown; // _original
  __u: number; // _flags
  type?: unknown;
  props?: SuspenseProps;
}

/** Mangled internal shape of the Suspense + suspending child component instances. */
interface InternalComponent {
  __u: number; // _pendingSuspensionCount (Suspense) / _flags (vnode-side reuse)
  o: InternalComponent[] | null; // _suspenders
  __b: InternalVNode | null; // _detachOnNextRender
  __v: InternalVNode; // _vnode
  __P?: unknown; // _parentDom
  __O?: unknown; // _originalParentDom
  __e?: boolean; // _force
  __R?: (() => void) | null; // _onResolve
  __z?: boolean; // _unmounted
  __H?: { __: HookEntry[] } | null; // __hooks { _list }
  __c?: ChildDidSuspend; // _childDidSuspend (mangle collides with _component)
  __a?: (vnode: InternalVNode) => Unsuspend | undefined; // _suspended (SuspenseList)
  state: { __a?: InternalVNode | null }; // state._suspended
  props: SuspenseProps;
  setState(partial: { __a: InternalVNode | null }): void;
  forceUpdate(): void;
}

type ChildDidSuspend = (
  promise: Promise<unknown>,
  suspendingVNode: InternalVNode
) => void;
type Unsuspend = (unsuspend: () => void) => void;

interface HookEntry {
  // _cleanup is the effect callback's return value, which preact stores
  // verbatim. It can be a truthy non-function (e.g. `useEffect(() => true)`),
  // so it must be typeof-guarded before calling (see detachedClone), matching
  // compat's `typeof effect._cleanup == 'function'`.
  __c?: unknown; // _cleanup
}

interface InternalOptions {
  __e?: (
    error: unknown,
    newVNode: InternalVNode,
    oldVNode: InternalVNode,
    errorInfo?: unknown
  ) => void; // _catchError
  unmount?: (vnode: InternalVNode) => void;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

// Defensive: ESM caches this module so the patch runs once, but guard anyway so
// a duplicated module instance can never double-wrap the chained handlers.
const PATCHED = Symbol.for('hono-preact.suspense.patched');
const opts = options as unknown as InternalOptions & { [PATCHED]?: true };

if (!opts[PATCHED]) {
  opts[PATCHED] = true;

  // --- options._catchError (mangled: options.__e) --------------------------
  // Core walks the _parent chain to a component implementing _childDidSuspend.
  const oldCatchError = opts.__e;
  opts.__e = function (error, newVNode, oldVNode, errorInfo) {
    if (isThenable(error)) {
      let component: InternalComponent | null | undefined;
      let vnode: InternalVNode | null | undefined = newVNode;
      for (; vnode && (vnode = vnode.__); ) {
        if ((component = vnode.__c) && component.__c) {
          if (newVNode.__e == null) {
            newVNode.__e = oldVNode.__e;
            newVNode.__k = oldVNode.__k;
          }
          // Found a Suspense; do NOT fall through to oldCatchError.
          return component.__c(error, newVNode);
        }
      }
    }
    if (oldCatchError) oldCatchError(error, newVNode, oldVNode, errorInfo);
  };

  // --- options.unmount -----------------------------------------------------
  const oldUnmount = opts.unmount;
  opts.unmount = function (vnode) {
    const component = vnode.__c;
    if (component) component.__z = true;
    if (component && component.__R) {
      component.__R();
    }
    if (component && vnode.__u & MODE_HYDRATE) {
      vnode.type = null;
    }
    if (oldUnmount) oldUnmount(vnode);
  };
}

// detachedClone: park the suspended subtree off-DOM while the fallback shows
// (non-hydration path).
function detachedClone(
  vnode: InternalVNode | null,
  detachedParent: unknown,
  parentDom: unknown
): InternalVNode | null {
  if (vnode) {
    const comp = vnode.__c;
    if (comp && comp.__H) {
      comp.__H.__.forEach((effect) => {
        if (typeof effect.__c === 'function') effect.__c();
      });
      comp.__H = null;
    }

    vnode = { ...vnode };
    if (vnode.__c != null) {
      if (vnode.__c.__P === parentDom) {
        vnode.__c.__P = detachedParent;
      }
      vnode.__c.__e = true;
      vnode.__c = null;
    }

    vnode.__k =
      vnode.__k &&
      vnode.__k.map((child) => detachedClone(child, detachedParent, parentDom));
  }
  return vnode;
}

// removeOriginal: re-attach a hydrated suspended subtree to its original parent
// once the suspension completes.
function removeOriginal(
  vnode: InternalVNode | null,
  detachedParent: unknown,
  originalParent: { appendChild(node: unknown): void } | undefined
): InternalVNode | null {
  if (vnode && originalParent) {
    vnode.__v = null;
    vnode.__k =
      vnode.__k &&
      vnode.__k.map((child) =>
        removeOriginal(child, detachedParent, originalParent)
      );

    if (vnode.__c) {
      if (vnode.__c.__P === detachedParent) {
        if (vnode.__e) {
          originalParent.appendChild(vnode.__e);
        }
        vnode.__c.__e = true;
        vnode.__c.__P = originalParent;
      }
    }
  }
  return vnode;
}

// suspended(): notify a parent SuspenseList (if any) that a descendant suspended.
function suspended(vnode: InternalVNode): Unsuspend | undefined {
  const parent = vnode.__;
  const component = parent && parent.__c;
  if (component && component.__a) return component.__a(vnode);
  return undefined;
}

interface SuspenseProps {
  fallback?: ComponentChildren;
  children?: ComponentChildren;
}
interface SuspenseState {
  __a?: InternalVNode | null;
}

class SuspenseImpl extends Component<SuspenseProps, SuspenseState> {
  constructor(props: SuspenseProps) {
    super(props);
    const self = this as unknown as InternalComponent;
    // Mangled init fields (compat sets _pendingSuspensionCount / _suspenders /
    // _detachOnNextRender in its constructor).
    self.__u = 0;
    self.o = null;
    self.__b = null;
  }

  componentWillUnmount() {
    (this as unknown as InternalComponent).o = [];
  }

  // _childDidSuspend, mangled to `__c`. Core's _catchError invokes this.
  __c(promise: Promise<unknown>, suspendingVNode: InternalVNode) {
    const suspendingComponent = suspendingVNode.__c!;
    const c = this as unknown as InternalComponent;

    if (c.o == null) c.o = [];
    c.o.push(suspendingComponent);

    const resolve = suspended(c.__v);

    let resolved = false;
    const onResolved = () => {
      if (resolved || c.__z) return;
      resolved = true;
      suspendingComponent.__R = null;
      if (resolve) {
        resolve(onSuspensionComplete);
      } else {
        onSuspensionComplete();
      }
    };

    suspendingComponent.__R = onResolved;

    // Null _parentDom so setState/forceUpdate can't schedule renders while
    // suspended; restore before forceUpdate on resolve.
    const originalParentDom = suspendingComponent.__P;
    suspendingComponent.__P = null;

    const onSuspensionComplete = () => {
      if (!--c.__u) {
        if (c.state.__a) {
          const suspendedVNode = c.state.__a;
          const sc = suspendedVNode.__c!;
          c.__v.__k![0] = removeOriginal(
            suspendedVNode,
            sc.__P,
            sc.__O as { appendChild(node: unknown): void } | undefined
          );
        }

        c.setState({ __a: (c.__b = null) });

        let item: InternalComponent | undefined;
        while ((item = c.o!.pop())) {
          item.__P = originalParentDom;
          item.forceUpdate();
        }
      }
    };

    // During hydration we do NOT set _suspended: the real SSR markup stays on
    // screen to be adopted (hydrated) when the suspension resolves.
    if (!c.__u++ && !(suspendingVNode.__u & MODE_HYDRATE)) {
      c.setState({ __a: (c.__b = c.__v.__k![0]) });
    }
    promise.then(onResolved, onResolved);
  }

  render(props: SuspenseProps, state: SuspenseState) {
    const self = this as unknown as InternalComponent;
    if (self.__b) {
      // _detachOnNextRender set: park the suspended subtree off-DOM.
      if (self.__v.__k) {
        const detachedParent = document.createElement('div');
        const firstChild = self.__v.__k[0];
        const detachedComponent = firstChild && firstChild.__c;
        if (detachedComponent) {
          detachedComponent.__O = detachedComponent.__P;
          self.__v.__k[0] = detachedClone(
            self.__b,
            detachedParent,
            detachedComponent.__P
          );
        }
      }
      self.__b = null;
    }

    // Wrap the fallback so it is not marked as aborting mid-hydration.
    const fallback =
      (state.__a && createElement(Fragment, null, props.fallback)) || null;
    if (fallback) {
      (fallback as unknown as InternalVNode).__u &= ~MODE_HYDRATE;
    }

    return [
      createElement(Fragment, null, state.__a ? null : props.children),
      fallback,
    ];
  }
}

export const Suspense = SuspenseImpl as unknown as ComponentClass<
  SuspenseProps,
  unknown
>;
