import type { StandardSchemaV1 } from '@standard-schema/spec';

/** The input type a Standard Schema accepts (pre-validation). */
export type InferSchemaInput<S extends StandardSchemaV1> =
  StandardSchemaV1.InferInput<S>;

/** The output type a Standard Schema produces (post-validation/coercion). */
export type InferSchemaOutput<S extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<S>;
