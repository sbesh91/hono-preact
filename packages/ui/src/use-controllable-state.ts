import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';

interface UseControllableStateOptions<T> {
  value?: T; // controlled; when defined the component is controlled
  defaultValue: T; // uncontrolled initial value
  onChange?: (value: T) => void;
}

// A controlled/uncontrolled state hook. When `value` is provided the hook is
// controlled (reads `value`, never self-updates; `onChange` is the only way
// out). When absent it is uncontrolled (internal state, seeded from
// `defaultValue`). The setter is stable across renders so effects can depend
// on it without re-subscribing. The mode is assumed fixed for the component's
// lifetime: switching controlled <-> uncontrolled does not re-seed internal
// state (matches typical usage and React's own controllable-state hooks).
export function useControllableState<T>(
  opts: UseControllableStateOptions<T>
): [T, (next: T) => void] {
  const { value, defaultValue, onChange } = opts;
  const isControlled = value !== undefined;

  const [internal, setInternal] = useState<T>(defaultValue);

  // Keep the latest onChange / controlled-ness in refs so the stable setter
  // closes over fresh values without changing identity.
  const onChangeRef = useRef(onChange);
  const isControlledRef = useRef(isControlled);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    isControlledRef.current = isControlled;
  });

  // `value !== undefined` narrows `T | undefined` to `T`, so no cast is needed.
  const current = value !== undefined ? value : internal;

  const setValue = useCallback((next: T) => {
    if (!isControlledRef.current) setInternal(next);
    onChangeRef.current?.(next);
  }, []);

  return [current, setValue];
}
