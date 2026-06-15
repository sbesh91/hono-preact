import { mergeRefs } from 'hono-preact-ui';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

// One input node feeds two refs at once via mergeRefs: an internal ref used to
// focus it, and a measuring ref used to read its width. Both receiving the same
// node is the visible proof. Styling: .docs-mergerefs* in root.css.
export function MergeRefsDemo() {
  const focusRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div class="docs-mergerefs">
      <input
        ref={mergeRefs(focusRef, measureRef)}
        class="docs-mergerefs-input"
        defaultValue="resize me"
        aria-label="Demo input"
      />
      <button
        type="button"
        class="docs-mergerefs-btn"
        onClick={() => focusRef.current?.focus()}
      >
        Focus (internal ref)
      </button>
      <span class="docs-mergerefs-readout">
        measured width: {width != null ? `${Math.round(width)}px` : '…'}
      </span>
    </div>
  );
}
