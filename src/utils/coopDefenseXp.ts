// Pure progression arithmetic shared by runtime snapshots and save validation.
const FIRST_LEVEL_UP_XP = 20;
const XP_INCREASE_PER_LEVEL = 80;

export function sanitizeXp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function getCoopDefenseXpThresholdForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  const completedLevelUps = safeLevel - 1;
  if (completedLevelUps === 0) return 0;
  return completedLevelUps * (
    2 * FIRST_LEVEL_UP_XP + (completedLevelUps - 1) * XP_INCREASE_PER_LEVEL
  ) / 2;
}

export function getCoopDefenseLevelForXp(totalXp: number): number {
  const safeXp = sanitizeXp(totalXp);
  // Invert threshold(n) = n * (2 * first + (n - 1) * increase) / 2,
  // where n is the number of completed level-ups.
  const linearCoefficient = 2 * FIRST_LEVEL_UP_XP - XP_INCREASE_PER_LEVEL;
  const completedLevelUps = Math.floor(
    (-linearCoefficient + Math.sqrt(linearCoefficient ** 2 + 8 * XP_INCREASE_PER_LEVEL * safeXp))
    / (2 * XP_INCREASE_PER_LEVEL),
  );
  return Math.max(1, completedLevelUps + 1);
}
