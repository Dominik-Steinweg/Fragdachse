import type { SyncedSpawnZoneAlert } from '../types';

/** The haze over a spawn zone thickens this long before its enemies arrive (GDD Void-Gefahrenzonen V1, E8). */
export const SPAWN_ZONE_ALERT_LEAD_MS = 2000;
/** At most this many zones are announced at once; the earliest arrivals win. */
export const MAX_SPAWN_ZONE_ALERTS = 16;

/**
 * Merges the host's announcements per zone: the earliest warning and arrival, the latest end
 * (an open end wins). Sorted by arrival so the most urgent survive the cap, then by id.
 */
export function mergeSpawnZoneAlerts(alerts: readonly SyncedSpawnZoneAlert[]): SyncedSpawnZoneAlert[] {
  const byZone = new Map<string, SyncedSpawnZoneAlert>();
  for (const alert of alerts) {
    // Zone and structure ids live in separate namespaces.
    const key = spawnAlertPlaceKey(alert);
    const known = byZone.get(key);
    if (!known) { byZone.set(key, { ...alert }); continue; }
    byZone.set(key, {
      zoneId: alert.zoneId,
      ...(alert.structure ? { structure: true as const } : {}),
      fromMs: Math.min(known.fromMs, alert.fromMs),
      atMs: Math.min(known.atMs, alert.atMs),
      endMs: known.endMs === null || alert.endMs === null ? null : Math.max(known.endMs, alert.endMs),
    });
  }
  return [...byZone.values()]
    .sort((left, right) => left.atMs - right.atMs || (left.zoneId < right.zoneId ? -1 : left.zoneId > right.zoneId ? 1 : 0))
    .slice(0, MAX_SPAWN_ZONE_ALERTS)
    .map(alert => ({ ...alert, fromMs: Math.round(alert.fromMs), atMs: Math.round(alert.atMs), endMs: alert.endMs === null ? null : Math.round(alert.endMs) }));
}

/** Stable identity of a merged alert list for change-only publication. */
export function spawnZoneAlertSignature(alerts: readonly SyncedSpawnZoneAlert[]): string {
  return alerts.map(alert => `${spawnAlertPlaceKey(alert)}:${alert.fromMs}:${alert.atMs}:${alert.endMs ?? 'open'}`).join('|');
}

function spawnAlertPlaceKey(alert: SyncedSpawnZoneAlert): string {
  return `${alert.structure ? 'structure' : 'zone'}:${alert.zoneId}`;
}

/**
 * Haze build-up of one alert at mission time `nowMs`, 0..1: rises from `fromMs` to `atMs`, holds
 * until `endMs` and settles over `settleMs` after it.
 */
export function spawnZoneAlertLevel(alert: SyncedSpawnZoneAlert, nowMs: number, settleMs = 2500): number {
  if (nowMs <= alert.fromMs) return 0;
  const rise = alert.atMs > alert.fromMs ? Math.min(1, (nowMs - alert.fromMs) / (alert.atMs - alert.fromMs)) : 1;
  const eased = rise * rise * (3 - 2 * rise);
  if (alert.endMs === null || nowMs <= alert.endMs) return eased;
  const settle = Math.max(0, 1 - (nowMs - alert.endMs) / Math.max(1, settleMs));
  return eased * settle * settle;
}
