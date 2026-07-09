// The framework's browser floor for CSS lowering, encoded for Lightning CSS
// (major << 16 | minor << 8). Policy: Baseline Widely Available (features
// interoperable across the core browsers for ~30 months). Floor as of this
// writing: the late-2023 releases. Revisit at each release; bumping only ever
// REMOVES lowering (newer floors need less transpilation), so a stale value is
// extra bytes, not breakage.
import type { Targets } from 'lightningcss';

const v = (major: number, minor = 0): number => (major << 16) | (minor << 8);

export const BASELINE_TARGETS: Targets = {
  chrome: v(120),
  edge: v(120),
  firefox: v(121),
  safari: v(17, 2),
  ios_saf: v(17, 2),
};
