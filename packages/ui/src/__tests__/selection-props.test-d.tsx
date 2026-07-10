// Type-level assertions for the discriminated selection props (runs under
// `pnpm test:types` only). h() calls are used (mostly, see below) instead of
// JSX so each ts-expect-error comment anchors to exactly one expression.
import { describe, it, expectTypeOf } from 'vitest';
import { h } from 'preact';
import { SelectRoot } from '../select/select.js';
import { ComboboxRoot } from '../combobox/combobox.js';
import { MenuRadioGroup } from '../menu/menu.js';
import {
  normalizeSelectionProps,
  type SelectionProps,
  type SingleSelectionProps,
  type MultipleSelectionProps,
  type NormalizedSelection,
} from '../index.js';

type Status = 'todo' | 'done';
declare const size: 'sm' | 'lg';
declare const onScalar: (v: string) => void;

describe('SelectionProps discrimination', () => {
  it('is the union of the single and multiple arms, re-exported publicly', () => {
    expectTypeOf<SelectionProps<string>>().toEqualTypeOf<
      SingleSelectionProps<string> | MultipleSelectionProps<string>
    >();
    expectTypeOf(
      normalizeSelectionProps<string>({ value: null })
    ).toEqualTypeOf<NormalizedSelection<string>>();
  });

  it('single mode infers a (Value | null) handler on both Roots', () => {
    h(SelectRoot<Status>, {
      value: 'todo',
      onValueChange: (v) => expectTypeOf(v).toEqualTypeOf<Status | null>(),
    });
    h(ComboboxRoot<Status>, {
      value: 'todo',
      onValueChange: (v) => expectTypeOf(v).toEqualTypeOf<Status | null>(),
    });
  });

  it('multiple mode infers a Value[] handler on both Roots', () => {
    h(SelectRoot<Status>, {
      multiple: true,
      value: ['todo'],
      onValueChange: (v) => expectTypeOf(v).toEqualTypeOf<Status[]>(),
    });
    h(ComboboxRoot<Status>, {
      multiple: true,
      value: ['todo'],
      onValueChange: (v) => expectTypeOf(v).toEqualTypeOf<Status[]>(),
    });
  });

  it('rejects shape mismatches across the discriminant', () => {
    // @ts-expect-error multiple:true requires an array value, not a scalar
    h(SelectRoot<string>, { multiple: true, value: 'a' });
    // @ts-expect-error a multiple select hands the handler Value[], not a bare Value
    h(SelectRoot<string>, { multiple: true, onValueChange: onScalar });
    // @ts-expect-error an array value requires multiple:true
    h(SelectRoot<string>, { value: ['a'] });
  });

  it('with no explicit generic and no value prop, Value defaults to string', () => {
    // A generic function component assigned bare (no `<Value>`) into `h`'s
    // `ComponentType<P>` parameter goes through function-type assignability,
    // not call inference, so it cannot recover the default the moment a
    // `value` key of type `Value | null` is present at all (even `undefined`
    // literal) -- TS falls back to the `{}` constraint instead of the `= string`
    // default in that path. JSX resolves generic components through a
    // separate, inference-aware path that does honor the default, but only
    // when `value` is omitted outright, so this assertion (uniquely in this
    // file) uses JSX instead of `h()` and omits `value`.
    <SelectRoot
      onValueChange={(v) => expectTypeOf(v).toEqualTypeOf<string | null>()}
    />;
  });
});

describe('MenuRadioGroup generic', () => {
  it('infers V from value and types the handler over it', () => {
    // A generic component used bare in `h()` (as opposed to
    // `MenuRadioGroup<...>` below) cannot recover V from `value` for the
    // same reason documented on the SelectRoot default-inference assertion
    // above: `h`'s `ComponentType<P>` parameter goes through function-type
    // assignability, not call inference, once the component is left
    // uninstantiated. JSX resolves a generic component through a separate,
    // inference-aware path that does infer V from `value` here.
    <MenuRadioGroup
      value={size}
      onValueChange={(v) => expectTypeOf(v).toEqualTypeOf<'sm' | 'lg'>()}
    />;
    h(MenuRadioGroup<'sm' | 'lg'>, {
      defaultValue: 'sm',
      onValueChange: (v) => expectTypeOf(v).toEqualTypeOf<'sm' | 'lg'>(),
    });
  });

  it('rejects a value outside the handler union', () => {
    // @ts-expect-error 'xl' is not accepted by a ('sm' | 'lg') handler
    h(MenuRadioGroup<'sm' | 'lg'>, { value: 'xl', onValueChange: (v) => v });
  });
});
