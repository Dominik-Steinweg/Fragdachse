/** Normalisiert die beim Rundenstart festgelegte Zahl menschlicher Spieler. */
export function normalizeCoopDefenseHumanPlayerCount(humanPlayerCount: number): number {
  return Math.max(1, Math.floor(humanPlayerCount));
}

/** Endliche Skalierungswerte folgen dem bestehenden Gegner-Konfigurationsmuster. */
export function normalizeCoopDefensePlayerScalingFactor(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

export function resolveCoopDefensePositiveInteger(
  baseValue: number,
  factor: number | undefined,
  humanPlayerCount: number,
): number {
  return Math.max(1, Math.round(scaleByCoopDefenseHumanPlayers(baseValue, factor, humanPlayerCount)));
}

export function resolveCoopDefenseNonNegativeInteger(
  baseValue: number,
  factor: number | undefined,
  humanPlayerCount: number,
): number {
  return Math.max(0, Math.round(scaleByCoopDefenseHumanPlayers(baseValue, factor, humanPlayerCount)));
}

export function resolveCoopDefensePositiveNumber(
  baseValue: number,
  factor: number | undefined,
  humanPlayerCount: number,
): number {
  return Math.max(1, scaleByCoopDefenseHumanPlayers(baseValue, factor, humanPlayerCount));
}

export function scaleByCoopDefenseHumanPlayers(
  baseValue: number,
  factor: number | undefined,
  humanPlayerCount: number,
): number {
  const extraPlayers = Math.max(0, normalizeCoopDefenseHumanPlayerCount(humanPlayerCount) - 1);
  const normalizedFactor = factor ?? 0;
  if (extraPlayers === 0 || normalizedFactor === 0) {
    return baseValue;
  }

  if (normalizedFactor > 0) {
    return baseValue * (1 + normalizedFactor * extraPlayers);
  }

  return baseValue / (1 + Math.abs(normalizedFactor) * extraPlayers);
}
