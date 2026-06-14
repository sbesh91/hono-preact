import { useCallback, useState } from 'preact/hooks';

export interface DescriptionRegistry {
  // True while at least one Description part is mounted.
  hasDescription: boolean;
  // Call from a Description part's layout effect; returns the deregister cleanup.
  registerDescription: () => () => void;
}

// Reference-counted description presence, shared by Dialog and Popover so the
// Popup wires aria-describedby only when a Description is actually rendered.
export function useDescriptionRegistry(): DescriptionRegistry {
  const [count, setCount] = useState(0);
  const registerDescription = useCallback(() => {
    setCount((c) => c + 1);
    return () => setCount((c) => c - 1);
  }, []);
  return { hasDescription: count > 0, registerDescription };
}
