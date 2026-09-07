import type { RadialDamageFalloffConfig } from '../types';
import { computeRadialDamage } from '../utils/radialDamage';

/** Ein einzelner Flächenschaden auf die Umgebung. */
export interface RadialEnvironmentDamageRequest {
  x:               number;
  y:               number;
  radius:          number;
  /** Schaden im Zentrum, vor Falloff und `rockDamageMult`. */
  damage:          number;
  /** Faktor der Waffe/Explosion auf Felsen. `0` schaltet Umgebungsschaden ab. */
  rockDamageMult:  number;
  falloff?:        RadialDamageFalloffConfig;
}

/**
 * Anbindung des Resolvers an einen konkreten Felsbestand.
 *
 * Host-Gameplay reicht hier den World-Bestand samt Zielstatus-Trichter herein. Der Resolver
 * selbst kennt weder Netzwerk noch Activity-/Rundenzustand.
 */
export interface EnvironmentRockSink {
  /**
   * Besucht nur die Kandidaten in der konservativen Grid-Radius-Range. Der Aufrufer prueft
   * Mittelpunkt, Aktivitaet und alle weiteren exakten Trefferregeln.
   */
  forEachRockInRadius?: (
    x: number,
    y: number,
    radius: number,
    visit: (index: number, rockX: number, rockY: number) => void,
  ) => void;
  /** Kompatibler Fallback fuer lokale Bestände ohne Radiusindex (z. B. reine Resolver-Tests). */
  forEachActiveRock?: (visit: (index: number, x: number, y: number) => void) => void;
  /**
   * Zielstatus-Trichter vor dem Abzug (Unverwundbarkeit, Konstrukt-Regeln, Team-Schutz).
   * Ein Bestand ohne solche Regeln gibt den Schaden unverändert zurück.
   */
  resolveRockDamage(index: number, damage: number, attackerId: string): number;
  /** Zieht den Schaden atomar ab; `null` bedeutet beim Commit nicht mehr vorhanden/stale. */
  applyRockDamage(index: number, damage: number, attackerId: string): {
    readonly actualDamage: number;
    readonly remainingIntegrity: number;
    readonly becameDestroyed: boolean;
  } | null;
  /** Der Fels ist auf 0 HP gefallen. */
  onRockDestroyed(index: number, attackerId: string): void;
}

/** Ergebnis eines Umgebungsschadens – die *tatsächlich* betroffenen Felsen. */
export interface RadialEnvironmentDamageResult {
  /** Felsen, die real Schaden genommen haben. */
  damagedRockIndices: number[];
  /** Teilmenge davon, die dabei zerstört wurde. */
  destroyedRockIndices: number[];
}

const EMPTY_RADIAL_ENVIRONMENT_DAMAGE_RESULT: RadialEnvironmentDamageResult = {
  damagedRockIndices: [],
  destroyedRockIndices: [],
};

/**
 * Gemeinsamer Kern des Umgebungsschadens.
 *
 * Radius, Falloff, {@link computeRadialDamage} und `rockDamageMult` werden hier – und nur hier
 * – ausgewertet. Es gibt keine künstliche Obergrenze für die Trefferzahl und keine
 * nachträgliche Immunität: eine Explosion beschädigt genau die Felsen, die real im Radius
 * liegen. Wer die Zerstörung begrenzen will, muss den Schuss vorher anders planen. Hotpaths
 * ohne Auswertung des Trefferprotokolls können `collectResult = false` setzen und vermeiden
 * damit die Ergebnisarrays.
 */
export function applyRadialEnvironmentDamage(
  sink: EnvironmentRockSink,
  request: RadialEnvironmentDamageRequest,
  attackerId: string,
  collectResult = true,
): RadialEnvironmentDamageResult {
  const result = collectResult
    ? { damagedRockIndices: [], destroyedRockIndices: [] }
    : EMPTY_RADIAL_ENVIRONMENT_DAMAGE_RESULT;
  const { x, y, radius, damage, rockDamageMult, falloff } = request;
  if (rockDamageMult === 0) return result;

  const prepared: { index: number; damage: number }[] = [];
  const preparedIds = new Set<number>();

  const visitRock = (index: number, rockX: number, rockY: number): void => {
    // Bewusst dieselbe Formel wie `Phaser.Math.Distance.Between`, damit Grenzfälle exakt am
    // Radius sich nicht zwischen Arena und Lobby unterscheiden.
    const dx = x - rockX;
    const dy = y - rockY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > radius) return;

    const scaledDamage = Math.round(computeRadialDamage(distance, radius, damage, falloff) * rockDamageMult);
    if (scaledDamage <= 0) return;

    const resolvedDamage = sink.resolveRockDamage(index, scaledDamage, attackerId);
    if (resolvedDamage <= 0) return;
    // A physical rock can surface through more than one query alias; one effect unit commits it
    // once. The complete start set is prepared before any destruction callback can spawn targets.
    if (preparedIds.has(index)) return;
    preparedIds.add(index);
    prepared.push({ index, damage: resolvedDamage });
  };

  if (sink.forEachRockInRadius) {
    sink.forEachRockInRadius(x, y, radius, visitRock);
  } else {
    sink.forEachActiveRock?.(visitRock);
  }

  for (const candidate of prepared) {
    const outcome = sink.applyRockDamage(candidate.index, candidate.damage, attackerId);
    if (!outcome || outcome.actualDamage <= 0) continue;
    if (!collectResult) {
      if (outcome.becameDestroyed) sink.onRockDestroyed(candidate.index, attackerId);
      continue;
    }
    result.damagedRockIndices.push(candidate.index);
    if (outcome.becameDestroyed) {
      result.destroyedRockIndices.push(candidate.index);
      sink.onRockDestroyed(candidate.index, attackerId);
    }
  }

  return result;
}
