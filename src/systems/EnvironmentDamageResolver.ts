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
 * Gameplay reicht hier den runden-autoritativen Bestand samt Zielstatus-Trichter herein,
 * die Lobby ihren lokalen Ambient-Bestand. Der Resolver selbst kennt weder Netzwerk noch
 * Rundenzustand.
 */
export interface EnvironmentRockSink {
  /** Besucht jeden aktiven Fels mit Index und Weltmittelpunkt – in Layout-Reihenfolge. */
  forEachActiveRock(visit: (index: number, x: number, y: number) => void): void;
  /**
   * Zielstatus-Trichter vor dem Abzug (Unverwundbarkeit, Konstrukt-Regeln, Team-Schutz).
   * Ein Bestand ohne solche Regeln gibt den Schaden unverändert zurück.
   */
  resolveRockDamage(index: number, damage: number, attackerId: string): number;
  /** Zieht den Schaden ab und liefert die verbleibenden HP. */
  applyRockDamage(index: number, damage: number, attackerId: string): number;
  /** Der Fels ist auf 0 HP gefallen. */
  onRockDestroyed(index: number): void;
}

/** Ergebnis eines Umgebungsschadens – die *tatsächlich* betroffenen Felsen. */
export interface RadialEnvironmentDamageResult {
  /** Felsen, die real Schaden genommen haben. */
  damagedRockIndices: number[];
  /** Teilmenge davon, die dabei zerstört wurde. */
  destroyedRockIndices: number[];
}

/**
 * Gemeinsamer Kern des Umgebungsschadens.
 *
 * Radius, Falloff, {@link computeRadialDamage} und `rockDamageMult` werden hier – und nur hier
 * – ausgewertet. Es gibt keine künstliche Obergrenze für die Trefferzahl und keine
 * nachträgliche Immunität: eine Explosion beschädigt genau die Felsen, die real im Radius
 * liegen. Wer die Zerstörung begrenzen will, muss den Schuss vorher anders planen.
 */
export function applyRadialEnvironmentDamage(
  sink: EnvironmentRockSink,
  request: RadialEnvironmentDamageRequest,
  attackerId: string,
): RadialEnvironmentDamageResult {
  const result: RadialEnvironmentDamageResult = { damagedRockIndices: [], destroyedRockIndices: [] };
  const { x, y, radius, damage, rockDamageMult, falloff } = request;
  if (rockDamageMult === 0) return result;

  sink.forEachActiveRock((index, rockX, rockY) => {
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

    const remainingHp = sink.applyRockDamage(index, resolvedDamage, attackerId);
    result.damagedRockIndices.push(index);
    if (remainingHp <= 0) {
      result.destroyedRockIndices.push(index);
      sink.onRockDestroyed(index);
    }
  });

  return result;
}
