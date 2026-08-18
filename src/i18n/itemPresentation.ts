import type { CoopDefenseItemRarity, CoopDefenseItemSlot } from '../types';
import { COOP_DEFENSE_AFFIX_RULES } from '../config/coopDefenseItems';
import { formatNumber, formatPercent } from './format';
import { translate } from './catalog';
import type { Locale } from './types';

function text(key: string, locale: Locale, fallback: string): string {
  const value = translate(locale, key);
  return value.startsWith('⟦') ? fallback : value;
}

export function getItemSlotName(slot: CoopDefenseItemSlot, locale: Locale): string {
  return text(`item.slot.${slot}`, locale, slot);
}

export function getItemRarityName(rarity: CoopDefenseItemRarity, locale: Locale): string {
  return text(`item.rarity.${rarity}`, locale, rarity);
}

export function getItemStatName(stat: string, locale: Locale): string {
  return text(`item.stat.${stat}`, locale, stat.replace(/^player\./, '').replace(/[._]/g, ' '));
}

export function getItemAffixName(affixId: string, locale: Locale): string {
  return text(`item.affix.${affixId}.name`, locale, affixId.replace(/[_-]+/g, ' '));
}

export function getItemAffixText(affixId: string, value: number, locale: Locale): string {
  const percent = formatPercent(value, locale, 1);
  const number = formatNumber(value, locale, { maximumFractionDigits: 1 });
  const seconds = (ms: number) => `${formatNumber(ms / 1000, locale, { maximumFractionDigits: 1 })} ${translate(locale, 'item.unit.seconds')}`;
  const threshold = (fraction: number) => formatPercent(fraction, locale, 0);
  const durationMs = affixId === 'dash_speed'
    ? COOP_DEFENSE_AFFIX_RULES.afterburnerDurationMs
    : affixId === 'crossfire'
      ? COOP_DEFENSE_AFFIX_RULES.crossfireDurationMs
      : affixId === 'primary_vulnerability'
        ? COOP_DEFENSE_AFFIX_RULES.vulnerabilityDurationMs
        : affixId === 'primary_slow'
          ? COOP_DEFENSE_AFFIX_RULES.suppressionSlowDurationMs
          : affixId === 'adrenaline_kill_charge'
            ? COOP_DEFENSE_AFFIX_RULES.killChargeDurationMs
            : COOP_DEFENSE_AFFIX_RULES.emergencyRepairDelayMs;
  const key = `item.affix.${affixId}.description`;
  const rendered = translate(locale, key, {
    percent,
    number,
    threshold: threshold(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold),
    highHpThreshold: threshold(COOP_DEFENSE_AFFIX_RULES.highHpThreshold),
    count: COOP_DEFENSE_AFFIX_RULES.surroundedEnemyCount,
    radius: COOP_DEFENSE_AFFIX_RULES.surroundedRadiusPx,
    seconds: seconds(durationMs),
    vulnerabilityBonus: formatPercent(COOP_DEFENSE_AFFIX_RULES.vulnerabilityBonus, locale, 0),
    suppressionSlowFraction: formatPercent(COOP_DEFENSE_AFFIX_RULES.suppressionSlowFraction, locale, 0),
    fireChunkCount: COOP_DEFENSE_AFFIX_RULES.fireChunkCount,
    bloodRageLifeLeechBonus: formatPercent(COOP_DEFENSE_AFFIX_RULES.bloodRageLifeLeechBonus, locale, 0),
    distance: COOP_DEFENSE_AFFIX_RULES.movementChargeDistancePx,
    chunks: Math.max(1, Math.floor(value)),
    killChargeMaxStacks: COOP_DEFENSE_AFFIX_RULES.killChargeMaxStacks,
  });
  return rendered.startsWith('⟦') ? number : rendered;
}
