// packages/ui/src/use-typeahead.ts
import { useCallback, useEffect, useRef } from 'preact/hooks';

export interface UseTypeaheadOptions {
  idleMs?: number; // reset the buffer after this idle gap, default 500
}

// Returns an onChar(char) callback that accumulates printable characters into a
// query string and returns the current query. The buffer resets after idleMs of
// no input. The caller matches the returned query against item labels.
export function useTypeahead(
  opts: UseTypeaheadOptions = {}
): (char: string) => string {
  const { idleMs = 500 } = opts;
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  return useCallback(
    (char: string) => {
      clear();
      bufferRef.current += char;
      timerRef.current = setTimeout(() => {
        bufferRef.current = '';
        timerRef.current = null;
      }, idleMs);
      return bufferRef.current;
    },
    [clear, idleMs]
  );
}
