// Regression cases for the render-prop namespace collision (#373). Plain `.ts`
// so tsconfig.test.json checks it; a `.test-d.ts` would be excluded.
import type { LoaderRef } from '../define-loader.js';

declare const live: LoaderRef<{ n: number }, true>;
declare const single: LoaderRef<{ n: number }, false>;

// A caller prop named `data` must NOT alias into the stream state's `data`.
const A = live.View<number[], { data: string; label: string }>(
  (state, props) => {
    const acc: number[] = state.status === 'open' ? state.data : [];
    const label: string = props.label;
    const own: string = props.data; // caller's own `data`, still a string
    void acc;
    void label;
    void own;
    return null;
  },
  { initial: [] as number[], reduce: (acc, chunk) => [...acc, chunk.n] }
);
void A;

// A caller prop named `status` must NOT collapse the render argument to never.
const B = single.View<{ status: 'busy' }>((state, props) => {
  if (state.status === 'success') {
    const d = state.data;
    void d;
  }
  const own: 'busy' = props.status;
  void own;
  return null;
});
void B;

// Acc still infers with no explicit type argument (verified working; do not regress).
const C = live.View(
  (state) => {
    if (state.status === 'open') {
      const d: number[] = state.data;
      void d;
    }
    return null;
  },
  { initial: [] as number[], reduce: (acc, chunk) => [...acc, chunk.n] }
);
void C;
