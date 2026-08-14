import type {
  BalanceMapReport,
  BalanceMapSnapshot,
  BalanceRoundClassification,
  BalanceRoundRecord,
  CoopDefenseBalanceReport,
} from './types';
import { COOP_DEFENSE_BALANCE_RULESET_VERSION } from './types';

function finiteValues(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

export function average(values: readonly (number | null)[]): number | null {
  const finite = finiteValues(values);
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function median(values: readonly (number | null)[]): number | null {
  const finite = finiteValues(values).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[middle - 1] + finite[middle]) / 2 : finite[middle];
}

export function classifyBalanceRound(
  record: BalanceRoundRecord,
  snapshotsByMapId: ReadonlyMap<string, BalanceMapSnapshot>,
  rulesetVersion = COOP_DEFENSE_BALANCE_RULESET_VERSION,
): BalanceRoundClassification {
  const snapshot = snapshotsByMapId.get(record.mapId);
  if (!snapshot) return { record, status: 'STALE', staleReason: 'Map ist nicht mehr vorhanden.' };
  if (record.rulesetVersion !== rulesetVersion) {
    return {
      record,
      status: 'STALE',
      staleReason: `Regelwerk-Version ${record.rulesetVersion} statt ${rulesetVersion}.`,
    };
  }
  if (record.mapBalanceSignature !== snapshot.balanceSignature) {
    return { record, status: 'STALE', staleReason: 'Die Map-Balance wurde seit dem Test geaendert.' };
  }
  return { record, status: 'CURRENT', staleReason: null };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)} %`;
}

function buildAnomalies(
  snapshot: BalanceMapSnapshot,
  current: readonly BalanceRoundRecord[],
  comparable: readonly BalanceMapSnapshot[],
): readonly string[] {
  const messages: string[] = [];
  if (current.length < 3) {
    messages.push(`INFO: Nur ${current.length} aktuelle Testlaeufe – geringe Aussagekraft.`);
  }

  // Heuristik bewusst grob: erst ab drei vergleichbaren Kampagnenmaps wird ein
  // HP/min-Ausreisser gemeldet, damit einzelne Maps keine Scheingenauigkeit erzeugen.
  if (comparable.length >= 3 && snapshot.persistentReferenceHpPerMinute > 0) {
    const referenceMedian = median(comparable.map((map) => map.persistentReferenceHpPerMinute));
    if (referenceMedian && snapshot.persistentReferenceHpPerMinute > referenceMedian * 1.35) {
      messages.push('PRÜFEN: Der Referenzdruck liegt bei vergleichbaren Maps ungewoehnlich hoch.');
    } else if (referenceMedian && snapshot.persistentReferenceHpPerMinute < referenceMedian * 0.65) {
      messages.push('PRÜFEN: Der Referenzdruck liegt bei vergleichbaren Maps ungewoehnlich niedrig.');
    }
  }

  const durations = current.map((round) => round.durationMs);
  const averageDuration = average(durations);
  if (averageDuration !== null && snapshot.balanceReferenceDurationSec > 0) {
    const ratio = averageDuration / (snapshot.balanceReferenceDurationSec * 1000);
    if (ratio > 1.25) {
      messages.push(`PRÜFEN: Die reale Rundendauer liegt im Mittel ${Math.round((ratio - 1) * 100)} % ueber der Referenzdauer.`);
    } else if (ratio < 0.75 && current.length >= 3) {
      messages.push(`PRÜFEN: Die reale Rundendauer liegt im Mittel ${Math.round((1 - ratio) * 100)} % unter der Referenzdauer.`);
    }
  }

  const victories = current.filter((round) => round.outcome === 'victory').length;
  if (current.length >= 5) {
    const victoryRate = victories / current.length;
    if (victoryRate >= 0.8) messages.push(`PRÜFEN: Sehr hohe Siegquote (${formatPercent(victoryRate)} bei ${current.length} Laeufen).`);
    if (victoryRate <= 0.2) messages.push(`PRÜFEN: Sehr niedrige Siegquote (${formatPercent(victoryRate)} bei ${current.length} Laeufen).`);
  }

  const feedback = current.map((round) => round.feedback).filter((entry) => entry !== null);
  const averageDifficulty = average(feedback.map((entry) => entry?.difficulty ?? null));
  if (feedback.length >= 3 && averageDifficulty !== null) {
    if (averageDifficulty > 3.7) {
      messages.push(`PRÜFEN: Spieler bewerten diese Map ueberwiegend als zu schwer (Ø ${averageDifficulty.toFixed(1)} / 5 bei ${feedback.length} Bewertungen).`);
    } else if (averageDifficulty < 2.3) {
      messages.push(`PRÜFEN: Spieler bewerten diese Map ueberwiegend als zu leicht (Ø ${averageDifficulty.toFixed(1)} / 5 bei ${feedback.length} Bewertungen).`);
    }
  }

  const baseReserves = current
    .filter((round) => round.outcome === 'victory')
    .map((round) => round.ownMainBaseHpPercent)
    .filter((value): value is number => value !== null);
  const averageBaseReserve = average(baseReserves);
  if (baseReserves.length >= 3 && averageBaseReserve !== null && averageBaseReserve < 0.2) {
    messages.push('PRÜFEN: Siege enden haeufig mit sehr geringer eigener Basisreserve.');
  }

  if (feedback.length >= 3 && averageDifficulty !== null && averageDifficulty > 3.7 && comparable.length >= 3) {
    const referenceMedian = median(comparable.map((map) => map.persistentReferenceHpPerMinute));
    if (referenceMedian && snapshot.persistentReferenceHpPerMinute <= referenceMedian * 1.35) {
      messages.push('PRÜFEN: Statisch unauffaellig, aber im Playtest deutlich zu schwer bewertet.');
    }
  }
  return messages;
}

export function buildBalanceMapReport(
  snapshot: BalanceMapSnapshot,
  rounds: readonly BalanceRoundClassification[],
  comparable: readonly BalanceMapSnapshot[],
): BalanceMapReport {
  const current = rounds.filter((round) => round.status === 'CURRENT').map((round) => round.record);
  const rated = current.filter((round) => round.feedback !== null);
  const victoryCount = current.filter((round) => round.outcome === 'victory').length;
  return {
    snapshot,
    rounds,
    metrics: {
      currentRounds: current.length,
      ratedRounds: rated.length,
      staleRounds: rounds.filter((round) => round.status === 'STALE').length,
      victoryRate: current.length > 0 ? victoryCount / current.length : null,
      averageDurationMs: average(current.map((round) => round.durationMs)),
      medianDurationMs: median(current.map((round) => round.durationMs)),
      averageActualXp: average(current.map((round) => round.sharedXp)),
      averageDifficulty: average(rated.map((round) => round.feedback?.difficulty ?? null)),
      averagePacing: average(rated.map((round) => round.feedback?.pacing ?? null)),
      averageOwnBaseReserve: average(
        current.map((round) => round.ownMainBaseHpPercent),
      ),
    },
    anomalies: buildAnomalies(snapshot, current, comparable),
  };
}

export function buildCoopDefenseBalanceReport(
  snapshots: readonly BalanceMapSnapshot[],
  rounds: readonly BalanceRoundRecord[],
  rulesetVersion = COOP_DEFENSE_BALANCE_RULESET_VERSION,
): CoopDefenseBalanceReport {
  const snapshotsByMapId = new Map(snapshots.map((snapshot) => [snapshot.mapId, snapshot]));
  const classified = rounds.map((round) => classifyBalanceRound(round, snapshotsByMapId, rulesetVersion));
  const maps = snapshots.map((snapshot) => {
    const comparable = snapshot.mapId === '0'
      ? []
      : snapshots.filter((candidate) => candidate.mapId !== '0' && candidate.objective === snapshot.objective && candidate.mapId !== snapshot.mapId);
    return buildBalanceMapReport(
      snapshot,
      classified.filter((round) => round.record.mapId === snapshot.mapId),
      comparable,
    );
  });
  return {
    generatedAt: new Date().toISOString(),
    rounds: classified,
    maps,
    staleRoundCount: classified.filter((round) => round.status === 'STALE').length,
    currentRoundCount: classified.filter((round) => round.status === 'CURRENT').length,
  };
}
