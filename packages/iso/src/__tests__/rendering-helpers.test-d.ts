import { describe, it, expectTypeOf } from 'vitest';
import { signal } from '@preact/signals';
import type { ForProps } from '../for.js';
import type { ShowProps } from '../show.js';

describe('<For> / <Show> types', () => {
  it('For infers the item type in children and defaults by to identity', () => {
    const each = signal<readonly string[]>(['a']);
    const props: ForProps<string> = {
      each,
      children: (item, index) => {
        expectTypeOf(item).toEqualTypeOf<string>();
        expectTypeOf(index).toEqualTypeOf<number>();
        return null;
      },
    };
    void props;
  });

  it('For accepts a by key extractor for object arrays', () => {
    const each = signal<readonly { id: string }[]>([{ id: '1' }]);
    const props: ForProps<{ id: string }> = {
      each,
      by: (t) => t.id,
      children: (t) => t.id,
    };
    void props;
  });

  it('Show function child receives the NonNullable narrowed value', () => {
    const when = signal<{ name: string } | null>(null);
    const props: ShowProps<{ name: string } | null> = {
      when,
      children: (value) => {
        expectTypeOf(value).toEqualTypeOf<{ name: string }>();
        return value.name;
      },
    };
    void props;
  });
});
