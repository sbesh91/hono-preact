import { describe, expectTypeOf, it } from 'vitest';
import { defineAction } from '../action.js';
import { defineLoader } from '../define-loader.js';
import type {
  InferActionPayload,
  InferActionResult,
  InferActionChunk,
  InferLoaderData,
} from '../infer.js';
import type { Serialize } from '../internal/serialize.js';

describe('inference helpers', () => {
  it('extracts action payload, result, and chunk', () => {
    const charge = defineAction(
      async (_ctx, _payload: { cents: number }) => ({ at: new Date() })
    );
    expectTypeOf<InferActionPayload<typeof charge>>().toEqualTypeOf<{
      cents: number;
    }>();
    // Authored result type, NOT the wire shape: `at` stays a Date.
    expectTypeOf<InferActionResult<typeof charge>>().toEqualTypeOf<{
      at: Date;
    }>();
    // Composing with the public Serialize<> degrades the Date to string.
    expectTypeOf<
      Serialize<InferActionResult<typeof charge>>
    >().toEqualTypeOf<{ at: string }>();
  });

  it('extracts streaming chunk type', () => {
    // A streaming action is authored as a generator function (the third
    // ActionFn variant); `async () => ticker()` would be a Promise<Generator>
    // result, not a stream, and TChunk would stay `never`.
    const live = defineAction(async function* (): AsyncGenerator<
      { n: number },
      void,
      unknown
    > {
      yield { n: 1 };
    });
    expectTypeOf<InferActionChunk<typeof live>>().toEqualTypeOf<{ n: number }>();
  });

  it('extracts loader data as the authored T', () => {
    const movie = defineLoader(async () => ({ title: 'Dune', seen: new Date() }));
    expectTypeOf<InferLoaderData<typeof movie>>().toEqualTypeOf<{
      title: string;
      seen: Date;
    }>();
  });
});
