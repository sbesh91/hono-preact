// apps/site/scripts/docs-structure.d.mts
export type HeadingKind = 'reference' | 'nuance' | 'example' | 'neutral';
export type StructureProblem = { rule: 'R1' | 'R2' | 'R3'; message: string };
export function classifyHeading(text: string): HeadingKind;
export function analyzePageStructure(source: string): StructureProblem[];
