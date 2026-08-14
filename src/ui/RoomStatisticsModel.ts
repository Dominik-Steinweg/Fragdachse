import type { RoomPlayerStatistics } from '../network/RoomStatistics';

export function sortRoomStatistics(entries: readonly RoomPlayerStatistics[]): RoomPlayerStatistics[] {
  return [...entries].sort((left, right) => (
    right.damageDealt - left.damageDealt
    || right.damageTaken - left.damageTaken
    || left.name.localeCompare(right.name, 'de')
  ));
}

export function getRoomWinRate(entry: Pick<RoomPlayerStatistics, 'pvpWins' | 'pvpMatchesPlayed'>): number | null {
  return entry.pvpMatchesPlayed > 0 ? entry.pvpWins / entry.pvpMatchesPlayed : null;
}

export function formatRoomStatValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatRoomWinRate(entry: Pick<RoomPlayerStatistics, 'pvpWins' | 'pvpMatchesPlayed'>): string {
  const rate = getRoomWinRate(entry);
  return rate === null ? '—' : `${(rate * 100).toFixed(1)} %`;
}
