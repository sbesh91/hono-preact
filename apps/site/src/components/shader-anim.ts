// Duration over which the shader's wave amplitude eases from 0 to 1 on first
// paint, so the static gradient appears to come alive rather than full motion
// snapping on under the canvas fade-in.
export const AMP_RAMP_MS = 800;

// Maps elapsed time since the first painted frame to a wave-amplitude
// multiplier in [0, 1]. Reduced motion skips the ramp and renders a single
// static frame at full amplitude (matching the prior reduced-motion behavior).
export function rampAmplitude(
  elapsedMs: number,
  reduceMotion: boolean,
  rampMs: number = AMP_RAMP_MS
): number {
  if (reduceMotion) return 1;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= rampMs) return 1;
  return elapsedMs / rampMs;
}
