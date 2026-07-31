import { getCoopDefenseClassDefinition } from '../config/coopDefenseClasses';
import type { CoopDefenseClassId } from '../types';
import type { CoopDefenseResolvedEffectTotals } from './coopDefenseUpgrades';

/**
 * Einzige Auflösungsstelle für Coop-Defense-Spielerwerte.
 *
 * Host (`CoopDefensePlayerModifierSystem`) und Client (`ClientUpdateCoordinator`) müssen aus
 * denselben Effekt-Summen denselben Wert berechnen. Vorher lag die Formel doppelt vor und der
 * Client liess die Klassenmultiplikatoren weg – die HUD zeigte damit z. B. unter `dachs_of_steel`
 * ein halbes Rüstungsmaximum an. Deshalb ist die Berechnung hier als reine Funktion isoliert und
 * beide Seiten delegieren; neue Stat-Sonderfälle gehören ausschliesslich hierher.
 */

/** Prozentualer Bucket für global erhöhten Spielerschaden (Handschuhe, Item-Affixe). */
export const COOP_DEFENSE_PLAYER_STAT_OUTGOING_DAMAGE = 'player.outgoingDamage';
const STAT_ADRENALINE_REGEN_RATE = 'player.adrenalineRegenRate';
const STAT_RUN_SPEED = 'player.runSpeed';
const STAT_MAX_ARMOR = 'player.maxArmor';
const STAT_MAX_HP = 'player.maxHp';
/** Additive Buckets fuer Krit-Chance (Anteil) und Krit-Schaden (Zuschlag auf den Multiplikator). */
export const COOP_DEFENSE_PLAYER_STAT_CRITICAL_CHANCE = 'player.criticalChance';
export const COOP_DEFENSE_PLAYER_STAT_CRITICAL_DAMAGE = 'player.criticalDamage';

/**
 * Krit-Schaden ohne Klassenbezug.
 *
 * Ohne diesen Grundwert waere Krit-Chance aus Items nur mit `dachs_nukem` etwas wert, weil alle
 * anderen Klassen den Multiplikator 1 fuehren – ein Krit haette dann denselben Schaden wie ein
 * normaler Treffer. Klassenwerte oberhalb des Grundwerts bleiben unangetastet, die Klasse ist
 * also weiterhin die Quelle der Krit-Identitaet. Ohne Krit-Chance bleibt der Wert wirkungslos,
 * das Verhalten ohne Item-Affixe aendert sich dadurch nicht.
 */
export const COOP_DEFENSE_BASE_CRITICAL_DAMAGE_MULTIPLIER = 1.5;

export const EMPTY_COOP_DEFENSE_EFFECT_TOTALS: CoopDefenseResolvedEffectTotals = Object.freeze({
  additive: Object.freeze({}),
  percentage: Object.freeze({}),
});

export interface CoopDefenseOutgoingDamageResult {
  readonly amount: number;
  readonly isCritical: boolean;
}

/**
 * `(Basis + additiv) * (1 + prozentual)`, danach die multiplikativen Klassenwerte.
 *
 * `classId === null` ist die bonuslose Default-Klasse vor Abschluss von Map 5; dann wirken nur
 * die Effekt-Summen.
 */
export function resolveCoopDefenseStat(
  totals: CoopDefenseResolvedEffectTotals,
  classId: CoopDefenseClassId | null,
  stat: string,
  baseValue: number,
): number {
  const classDefinition = classId ? getCoopDefenseClassDefinition(classId) : null;
  // Die Adrenalin-Regeneration ist der einzige Wert, dessen Basis die Klasse ersetzen darf.
  const resolvedBase = stat === STAT_ADRENALINE_REGEN_RATE
    ? (classDefinition?.adrenalineRegenPerSecond ?? baseValue)
    : baseValue;
  let value = Math.max(
    0,
    (resolvedBase + (totals.additive[stat] ?? 0)) * (1 + (totals.percentage[stat] ?? 0)),
  );
  if (stat === STAT_RUN_SPEED) value *= classDefinition?.runSpeedMultiplier ?? 1;
  if (stat === STAT_MAX_ARMOR) value *= classDefinition?.maxArmorMultiplier ?? 1;
  if (stat === STAT_MAX_HP) value *= classDefinition?.maxHpMultiplier ?? 1;
  return value;
}

/**
 * Ausgehender Spielerschaden inklusive Krit-Wurf.
 *
 * Klassenwerte sind optionale Defaults, nicht Voraussetzung: ohne Klasse wirken Item- und
 * Upgrade-Boni trotzdem. Krit-Chance und Krit-Schaden addieren sich auf die Klassenwerte, der
 * Schadensmultiplikator wird mit dem prozentualen Bucket multipliziert.
 */
export function resolveCoopDefenseOutgoingDamage(
  totals: CoopDefenseResolvedEffectTotals,
  classId: CoopDefenseClassId | null,
  amount: number,
  allowCritical: boolean,
  random: () => number = Math.random,
  /**
   * Prozentualer Zuschlag aus bedingten Item-Affixen. Er addiert sich in denselben Bucket wie
   * Upgrades und Items – zehn Prozent von hier und fuenf aus dem Bucket ergeben x1.15, keine
   * multiplikative Verkettung.
   */
  bonusPercent = 0,
): CoopDefenseOutgoingDamageResult {
  const classDefinition = classId ? getCoopDefenseClassDefinition(classId) : null;
  const damageMultiplier = (classDefinition?.outgoingDamageMultiplier ?? 1)
    * (1 + (totals.percentage[COOP_DEFENSE_PLAYER_STAT_OUTGOING_DAMAGE] ?? 0) + bonusPercent);
  const criticalChance = Math.min(1, Math.max(
    0,
    (classDefinition?.criticalChance ?? 0) + (totals.additive[COOP_DEFENSE_PLAYER_STAT_CRITICAL_CHANCE] ?? 0),
  ));
  const criticalDamageMultiplier = Math.max(
    COOP_DEFENSE_BASE_CRITICAL_DAMAGE_MULTIPLIER,
    classDefinition?.criticalDamageMultiplier ?? 1,
  ) + (totals.additive[COOP_DEFENSE_PLAYER_STAT_CRITICAL_DAMAGE] ?? 0);

  const isCritical = allowCritical && criticalChance > 0 && random() < criticalChance;
  return {
    amount: Math.max(0, amount * damageMultiplier * (isCritical ? criticalDamageMultiplier : 1)),
    isCritical,
  };
}
