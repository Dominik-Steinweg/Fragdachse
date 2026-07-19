const HIT_FEEDBACK_REFERENCE_DAMAGE = 20;
const HIT_FEEDBACK_MIN_VOLUME = 0.12;
const HIT_FEEDBACK_MAX_VOLUME = 1.35;

export function getHitFeedbackVolumeScale(totalDamage: number): number {
  const normalizedDamage = Math.max(0, totalDamage) / HIT_FEEDBACK_REFERENCE_DAMAGE;
  return Math.min(
    HIT_FEEDBACK_MAX_VOLUME,
    Math.max(HIT_FEEDBACK_MIN_VOLUME, Math.sqrt(normalizedDamage)),
  );
}