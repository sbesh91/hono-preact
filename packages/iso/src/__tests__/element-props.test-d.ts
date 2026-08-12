// Type-level guards for the element-derived halves of `FormProps` and
// `NavLinkProps`, run via `pnpm test:types` (`vitest --typecheck.only`).
//
// Both types derive from `JSX.IntrinsicElements[tag]` rather than the generic
// `HTMLAttributes<T>`, which is what makes element-specific attributes
// spellable by a caller. Nothing pinned that before, so a refactor back to
// `HTMLAttributes` would silently make those props type errors again with a
// fully green suite.
import { expectTypeOf } from 'vitest';
import type { FormProps } from '../form.js';
import type { NavLinkProps } from '../nav-link.js';
import type { DistributiveOmit } from '../internal/element-props.js';

type Form = FormProps<unknown, unknown>;

// Form-specific attributes are spellable. These live on `FormHTMLAttributes`,
// not on the generic element attributes.
expectTypeOf<Form>().toHaveProperty('novalidate');
expectTypeOf<Form>().toHaveProperty('target');
expectTypeOf<Form>().toHaveProperty('autocomplete');

// Anchor-specific attributes are spellable. `willSoftNavigate` reads `target`
// and `download` off the rendered anchor at runtime, so a caller must be able
// to set them.
expectTypeOf<NavLinkProps>().toHaveProperty('target');
expectTypeOf<NavLinkProps>().toHaveProperty('download');
expectTypeOf<NavLinkProps>().toHaveProperty('rel');
expectTypeOf<NavLinkProps>().toHaveProperty('ping');

// The props the wrapper owns are omitted from the element half, not merely
// shadowed: `class`/`className` on the link, and the four the form re-types.
expectTypeOf<NavLinkProps['href']>().toBeString();
expectTypeOf<Form>().not.toHaveProperty('enctype');

// `DistributiveOmit` distributes: omitting a key from a union yields a union of
// omissions, not one collapsed object. This is what preserves Preact 11's
// per-element `role` narrowing through a prop-forwarding wrapper; a plain
// `Omit` here would widen `role` back to every `AriaRole`.
type Arm =
  | { kind: 'a'; only: 'x'; drop: 1 }
  | { kind: 'b'; only: 'y'; drop: 2 };
expectTypeOf<DistributiveOmit<Arm, 'drop'>>().toEqualTypeOf<
  { kind: 'a'; only: 'x' } | { kind: 'b'; only: 'y' }
>();
