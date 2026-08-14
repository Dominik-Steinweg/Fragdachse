import type { RoomPlayerStatistics } from '../network/RoomStatistics';
import { formatNumber, formatPercent } from '../i18n';
import type { Locale } from '../i18n/types';

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

export function formatRoomStatValue(value: number, locale: Locale = 'de'): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return formatNumber(value, locale, { maximumFractionDigits: 1 });
}

export function formatRoomWinRate(entry: Pick<RoomPlayerStatistics, 'pvpWins' | 'pvpMatchesPlayed'>, locale: Locale = 'de'): string {
  const rate = getRoomWinRate(entry);
  return rate === null ? '—' : formatPercent(rate, locale, 1);
}
