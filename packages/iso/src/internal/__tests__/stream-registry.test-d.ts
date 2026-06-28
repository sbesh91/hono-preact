// Type-level contract for the SSR streaming public types. Run under
// `pnpm test:types`. Guards the StreamEvent wire union and the ViewState render
// arg, which otherwise rest on runtime tests alone (#180).
import { expectTypeOf } from 'vitest';
import type { StreamEvent } from '../stream-registry.js';
import type { ViewState } from '../view-renderer.js';
import type { LoaderState, StreamState } from '../../loader-state.js';

// The StreamEvent union is the producer/consumer wire contract: three variants,
// each carrying a loaderId, discriminated by `type`. A dropped/renamed field or
// a collapsed variant must fail here.
function _streamEventProbe() {
  expectTypeOf<StreamEvent>().toEqualTypeOf<
    | { type: 'push'; loaderId: string; value: unknown }
    | { type: 'end'; loaderId: string }
    | {
        type: 'error';
        loaderId: string;
        error: { message: string; name: string };
      }
  >();

  // The discriminant narrows each variant to its payload.
  const ev = {} as StreamEvent;
  if (ev.type === 'push') expectTypeOf(ev.value).toEqualTypeOf<unknown>();
  if (ev.type === 'error')
    expectTypeOf(ev.error).toEqualTypeOf<{ message: string; name: string }>();
}

// ViewState is the discriminated value handed to every loader render function:
// a LoaderState or StreamState (data erased to unknown at this internal seam)
// plus the consumer's spread props index signature.
function _viewStateProbe() {
  expectTypeOf<ViewState>().toExtend<
    LoaderState<unknown> | StreamState<unknown>
  >();
  // The index signature carries arbitrary spread props.
  const state = {} as ViewState;
  expectTypeOf(state['anyProp']).toEqualTypeOf<unknown>();
  // The discriminant survives the intersection (status is still readable).
  expectTypeOf(state.status).not.toBeNever();
}

void _streamEventProbe;
void _viewStateProbe;
