// R10. The `FieldErrorsContext` default was a full `createFieldErrorStore()`,
// whose `fieldError(name)` get-or-creates a signal on READ and stores it in a
// closed-over Map. Nothing ever writes to that store, so it is documented as
// "inert" -- but reading it mutated it, and it lives at MODULE scope, shared by
// every SSR request in a long-lived worker isolate. A page rendering
// request-derived field names (`items.0.email`, `items.1.email`, ...) grew that
// Map for the lifetime of the isolate, with nothing in the app to point at.
//
// A store nothing writes to needs no per-field state at all.
import { describe, it, expect } from 'vitest';
import { FieldErrorsContext } from '../field-errors-context.js';
import { createFieldErrorStore } from '../field-error-signal.js';

describe('the out-of-Form default field-error store is inert', () => {
  it('hands every field the SAME signal, so a read allocates nothing', () => {
    // Identity is the observable proxy for "no per-name entry was created":
    // a get-or-create store necessarily returns a distinct signal per name.
    const def = defaultStore();
    expect(def.fieldError('a')).toBe(def.fieldError('b'));
    expect(def.fieldError('items.0.email')).toBe(def.fieldError('items.9.zip'));
  });

  it('reports no errors however many fields are read', () => {
    const def = defaultStore();
    for (let i = 0; i < 1000; i++) def.fieldError(`items.${i}.email`);
    expect(def.all.value).toEqual({});
    expect(def.fieldError('items.500.email').value).toEqual([]);
  });

  it('hands out a FROZEN empty array, so a stray mutation cannot corrupt it', () => {
    // The shared array is the trade for allocating nothing; freezing it is what
    // makes the trade safe. `createFieldErrorStore` allocates per field instead
    // and does not need this.
    const def = defaultStore();
    const messages = def.fieldError('a').value;
    expect(Object.isFrozen(messages)).toBe(true);
  });

  it('stays inert if something calls setAll on it', () => {
    const def = defaultStore();
    def.setAll({ a: ['boom'] });
    expect(def.all.value).toEqual({});
    expect(def.fieldError('a').value).toEqual([]);
  });

  it('leaves the REAL per-form store allocating per field', () => {
    // The inert default must not change the store a `<Form>` actually builds:
    // there a field's signal can later receive messages, so it needs its own.
    const real = createFieldErrorStore();
    expect(real.fieldError('a')).not.toBe(real.fieldError('b'));
    real.setAll({ a: ['required'] });
    expect(real.fieldError('a').value).toEqual(['required']);
    expect(real.fieldError('b').value).toEqual([]);
  });
});

/** The context's default value, as a consumer outside a `<Form>` receives it. */
function defaultStore() {
  // Preact stores a context's default on the internal `__` field; read it
  // through the public shape so the test does not depend on that name.
  const ctx = FieldErrorsContext as unknown as {
    __: ReturnType<typeof createFieldErrorStore>;
  };
  return ctx.__;
}
