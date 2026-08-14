import type { CoopDefenseBalanceReport } from './types';

function protectFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: unknown): string {
  const text = protectFormula(value === null || value === undefined ? '' : String(value));
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(';');
}

function percent(value: number | null): string {
  return value === null ? '' : `${(value * 100).toFixed(1)} %`;
}

function duration(value: number | null): string {
  if (value === null) return '';
  return `${(value / 1000).toFixed(1)} s`;
}

/** CSV fuer eine Map-Zeile: Theorie und aktuelle Playtest-Aggregate nebeneinander. */
export function toBalanceSummaryCsv(report: CoopDefenseBalanceReport): string {
  const lines = [csvRow([
    'Map', 'Modus', 'Referenzdauer (s)', 'Finite Gegner', 'Finite Gegner-HP', 'Finite Gegner-XP',
    'Persistente Referenz-Gegner', 'Persistente Referenz-HP', 'Persistente Referenz-XP', 'Referenz-HP/min',
    'Staerkster Encounter', 'Eigene Main-Basis-HP', 'Siegziel-HP', 'Tuerme', 'Turmtypen', 'Power-Ups',
    'Mechanik-Tags', 'Modellguete', 'Aktuelle Runden', 'Bewertete Runden', 'Veraltete Runden', 'Siegquote',
    'Durchschnittliche Rundendauer', 'Median Rundendauer', 'Durchschnittliche echte XP', 'Ø Schwierigkeit',
    'Ø Pacing', 'Ø eigene Basisreserve', 'Auffaelligkeiten',
  ])];
  for (const entry of report.maps) {
    const { snapshot, metrics } = entry;
    lines.push(csvRow([
      `${snapshot.mapId} · ${snapshot.displayName}`,
      snapshot.objective,
      snapshot.balanceReferenceDurationSec,
      snapshot.finiteEnemyCount,
      snapshot.finiteEnemyHp,
      snapshot.finiteEnemyXp,
      snapshot.persistentReferenceEnemyCount,
      snapshot.persistentReferenceHp,
      snapshot.persistentReferenceXp,
      snapshot.persistentReferenceHpPerMinute.toFixed(1),
      snapshot.strongestEncounter ? `${snapshot.strongestEncounter.encounterId} (${snapshot.strongestEncounter.totals.hp} HP)` : '',
      snapshot.friendlyMainBaseHp,
      snapshot.hostileVictoryTargetHp || '',
      snapshot.turretCount,
      snapshot.turretTypes.join(', '),
      snapshot.powerUpCount + snapshot.powerUpPedestalCount,
      snapshot.mechanicTags.join(', '),
      snapshot.modelQuality,
      metrics.currentRounds,
      metrics.ratedRounds,
      metrics.staleRounds,
      percent(metrics.victoryRate),
      duration(metrics.averageDurationMs),
      duration(metrics.medianDurationMs),
      metrics.averageActualXp?.toFixed(1) ?? '',
      metrics.averageDifficulty?.toFixed(1) ?? '',
      metrics.averagePacing?.toFixed(1) ?? '',
      percent(metrics.averageOwnBaseReserve),
      entry.anomalies.join(' | '),
    ]));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Technischer Round-Export mit dem Status der aktuellen Map-/Ruleset-Invalidierung. */
export function toBalanceRoundsCsv(report: CoopDefenseBalanceReport): string {
  const lines = [csvRow([
    'Rundenende', 'Map-ID', 'Map', 'Status', 'Grund fuer Veraltung', 'Ausgang', 'Rundendauer (s)',
    'Shared-XP', 'Frags', 'Spieler-HP', 'Spieler-Max-HP', 'Spieler-HP (%)', 'Armor',
    'Eigene Main-Basis-HP', 'Eigene Main-Basis-Max-HP', 'Eigene Basisreserve (%)',
    'Feindliche Main-Basis-HP', 'Feindliche Main-Basis-Max-HP', 'Feindliche Basis (%)',
    'Rest-Respawns', 'Coop-XP vor Runde', 'Level vor Runde', 'Klasse', 'Weapon1', 'Weapon2', 'Utility', 'Ultimate',
    'Upgrade-Profil', 'Items', 'Schwierigkeit', 'Pacing', 'Kommentar', 'Map-Balance-Signatur', 'Ruleset-Version',
  ])];
  const snapshots = new Map(report.maps.map((map) => [map.snapshot.mapId, map.snapshot]));
  for (const entry of report.rounds) {
    const round = entry.record;
    const snapshot = snapshots.get(round.mapId);
    lines.push(csvRow([
      new Date(round.roundEndedAt).toISOString(),
      round.mapId,
      snapshot?.displayName ?? '',
      entry.status === 'CURRENT' ? 'AKTUELL' : 'VERALTET',
      entry.staleReason ?? '',
      round.outcome,
      round.durationMs === null ? '' : (round.durationMs / 1000).toFixed(1),
      round.sharedXp,
      round.frags,
      round.playerHp,
      round.playerMaxHp,
      percent(round.playerHpPercent),
      round.armor,
      round.ownMainBaseHp,
      round.ownMainBaseMaxHp,
      percent(round.ownMainBaseHpPercent),
      round.hostileMainBaseHp,
      round.hostileMainBaseMaxHp,
      percent(round.hostileMainBaseHpPercent),
      round.survivalRemainingRespawns,
      round.build.coopXpBefore,
      round.build.levelBefore,
      round.build.classId,
      round.build.weapon1,
      round.build.weapon2,
      round.build.utility,
      round.build.ultimate,
      JSON.stringify(round.build.upgradeProfile ?? {}),
      JSON.stringify(round.build.items ?? []),
      round.feedback?.difficulty,
      round.feedback?.pacing,
      round.feedback?.comment ?? '',
      round.mapBalanceSignature,
      round.rulesetVersion,
    ]));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
