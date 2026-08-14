import type { CoopDefenseItemRarity, CoopDefenseItemSlot } from '../types';
import { COOP_DEFENSE_AFFIX_RULES } from '../config/coopDefenseItems';
import { formatNumber, formatPercent } from './format';
import type { Locale } from './types';

type Text = { readonly de: string; readonly en: string };

const SLOT_NAMES: Readonly<Record<CoopDefenseItemSlot, Text>> = {
  helmet: { de: 'Helm', en: 'Helmet' },
  gloves: { de: 'Handschuhe', en: 'Gloves' },
  armor: { de: 'Rüstung', en: 'Armor' },
  boots: { de: 'Stiefel', en: 'Boots' },
};

const RARITY_NAMES: Readonly<Record<CoopDefenseItemRarity, Text>> = {
  white: { de: 'Gewöhnlich', en: 'Common' },
  blue: { de: 'Selten', en: 'Rare' },
  yellow: { de: 'Episch', en: 'Epic' },
};

const STAT_NAMES: Readonly<Record<string, Text>> = {
  'player.adrenalineRegenRate': { de: 'Adrenalinregeneration', en: 'Adrenaline regeneration' },
  'player.outgoingDamage': { de: 'Schaden', en: 'Damage' },
  'player.maxHp': { de: 'Maximale HP', en: 'Max HP' },
  'player.runSpeed': { de: 'Bewegungsgeschwindigkeit', en: 'Move speed' },
};

const AFFIX_NAMES: Readonly<Record<string, Text>> = {
  max_hp: { de: 'Leben', en: 'Health' },
  hp_regen: { de: 'Lebensregeneration', en: 'Health regeneration' },
  max_armor: { de: 'Rüstungsmaximum', en: 'Max armor' },
  armor_regen: { de: 'Rüstungsregeneration', en: 'Armor regeneration' },
  armor_gain: { de: 'Rüstungsgewinn', en: 'Armor gain' },
  damage_reduction: { de: 'Schadensreduktion', en: 'Damage reduction' },
  low_hp_damage_reduction: { de: 'Letzte Bastion', en: 'Last Stand' },
  surrounded: { de: 'Umzingelt', en: 'Surrounded' },
  out_of_combat_armor_repair: { de: 'Notfallreparatur', en: 'Emergency Repair' },
  damage_reflection: { de: 'Dornenplatten', en: 'Thorn Plates' },
  life_leech: { de: 'Lifeleech', en: 'Life Leech' },
  outgoing_damage: { de: 'Schaden', en: 'Damage' },
  critical_chance: { de: 'Kritische Präzision', en: 'Critical Precision' },
  critical_damage: { de: 'Kritischer Schaden', en: 'Critical Damage' },
  crossfire: { de: 'Kreuzfeuer', en: 'Crossfire' },
  construction_capacity: { de: 'Baukapazität', en: 'Build Capacity' },
  remote_control: { de: 'Fernsteuerung', en: 'Remote Control' },
  primary_vulnerability: { de: 'Fokusfeuer', en: 'Focus Fire' },
  primary_culling: { de: 'Hinrichtung', en: 'Execution' },
  primary_slow: { de: 'Unterdrückungsmunition', en: 'Suppressive Ammo' },
  primary_kill_fire_chunks: { de: 'Brandzerfall', en: 'Fire Decay' },
  low_hp_blood_rage: { de: 'Blutrausch', en: 'Blood Rage' },
  high_hp_damage: { de: 'Unversehrt', en: 'Untouched' },
  run_speed: { de: 'Bewegungsgeschwindigkeit', en: 'Move speed' },
  burrow_speed: { de: 'Grabtempo', en: 'Burrow speed' },
  burrow_cost: { de: 'Grabverbrauch', en: 'Burrow cost' },
  max_adrenaline: { de: 'Maximales Adrenalin', en: 'Max adrenaline' },
  adrenaline_regen: { de: 'Adrenalinregeneration', en: 'Adrenaline regeneration' },
  adrenaline_gain: { de: 'Adrenalingewinn', en: 'Adrenaline gain' },
  adrenaline_cost: { de: 'Adrenalinverbrauch', en: 'Adrenaline cost' },
  rage_gain: { de: 'Wutgewinn', en: 'Rage gain' },
  max_rage: { de: 'Maximale Wut', en: 'Max rage' },
  utility_cooldown: { de: 'Utility-Cooldown', en: 'Utility cooldown' },
  adrenaline_kill_charge: { de: 'Kampfaufladung', en: 'Combat Charge' },
  adrenaline_from_damage: { de: 'Schockreaktion', en: 'Shock Response' },
  dash_range: { de: 'Dash-Reichweite', en: 'Dash range' },
  dash_speed: { de: 'Nachbrenner', en: 'Afterburner' },
  low_hp_speed: { de: 'Unter Druck', en: 'Under Pressure' },
  movement_charge_damage: { de: 'Kinetische Ladung', en: 'Kinetic Charge' },
  glutwanderer: { de: 'Glutwanderer', en: 'Ember Walker' },
};

function text(value: Text | undefined, locale: Locale, fallback: string): string {
  return value?.[locale] ?? fallback;
}

export function getItemSlotName(slot: CoopDefenseItemSlot, locale: Locale): string {
  return text(SLOT_NAMES[slot], locale, slot);
}

export function getItemRarityName(rarity: CoopDefenseItemRarity, locale: Locale): string {
  return text(RARITY_NAMES[rarity], locale, rarity);
}

export function getItemStatName(stat: string, locale: Locale): string {
  return text(STAT_NAMES[stat], locale, stat.replace(/^player\./, '').replace(/[._]/g, ' '));
}

export function getItemAffixName(affixId: string, locale: Locale): string {
  return text(AFFIX_NAMES[affixId], locale, affixId.replace(/[_-]+/g, ' '));
}

export function getItemAffixText(affixId: string, value: number, locale: Locale): string {
  const percent = formatPercent(value, locale, 1);
  const number = formatNumber(value, locale, { maximumFractionDigits: 1 });
  const seconds = (ms: number) => locale === 'de' ? `${formatNumber(ms / 1000, locale, { maximumFractionDigits: 1 })} s` : `${formatNumber(ms / 1000, locale, { maximumFractionDigits: 1 })} sec`;
  const threshold = (fraction: number) => formatPercent(fraction, locale, 0);
  switch (affixId) {
    case 'low_hp_damage_reduction': return locale === 'de'
      ? `Unter ${threshold(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} HP: ${percent} Schadensreduktion`
      : `Below ${threshold(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} HP: ${percent} damage reduction`;
    case 'surrounded': return locale === 'de'
      ? `Bei mindestens ${COOP_DEFENSE_AFFIX_RULES.surroundedEnemyCount} Gegnern in ${COOP_DEFENSE_AFFIX_RULES.surroundedRadiusPx} Reichweite: +${percent} Adrenalinregeneration`
      : `With at least ${COOP_DEFENSE_AFFIX_RULES.surroundedEnemyCount} enemies within ${COOP_DEFENSE_AFFIX_RULES.surroundedRadiusPx} px: +${percent} adrenaline regeneration`;
    case 'out_of_combat_armor_repair': return locale === 'de'
      ? `${seconds(COOP_DEFENSE_AFFIX_RULES.emergencyRepairDelayMs)} ohne Schaden: +${number} Rüstung/s`
      : `${seconds(COOP_DEFENSE_AFFIX_RULES.emergencyRepairDelayMs)} without taking damage: +${number} armor/s`;
    case 'damage_reflection': return locale === 'de'
      ? `Wirft ${percent} des erlittenen Schadens auf den Verursacher zurück`
      : `Reflects ${percent} of damage taken back at the attacker`;
    case 'crossfire': return locale === 'de'
      ? `Nach Waffe 2 verursacht Waffe 1 ${seconds(COOP_DEFENSE_AFFIX_RULES.crossfireDurationMs)} lang +${percent} Schaden`
      : `After using Weapon 2, Weapon 1 deals +${percent} damage for ${seconds(COOP_DEFENSE_AFFIX_RULES.crossfireDurationMs)}`;
    case 'remote_control': return locale === 'de'
      ? `Das nächste eigene Konstrukt verursacht +${percent} Schaden`
      : `Your next structure deals +${percent} damage`;
    case 'primary_vulnerability': return locale === 'de'
      ? `${percent} Chance bei Primärwaffentreffern: Das Ziel erleidet ${seconds(COOP_DEFENSE_AFFIX_RULES.vulnerabilityDurationMs)} lang ${formatPercent(COOP_DEFENSE_AFFIX_RULES.vulnerabilityBonus, locale, 0)} mehr Schaden aus allen Quellen`
      : `${percent} chance on primary-weapon hits: The target takes ${formatPercent(COOP_DEFENSE_AFFIX_RULES.vulnerabilityBonus, locale, 0)} more damage from all sources for ${seconds(COOP_DEFENSE_AFFIX_RULES.vulnerabilityDurationMs)}`;
    case 'primary_culling': return locale === 'de'
      ? `${percent} Chance, einen Gegner unter ${threshold(COOP_DEFENSE_AFFIX_RULES.cullingHpThreshold)} HP sofort zu erledigen (nicht bei Bossen)`
      : `${percent} chance to instantly execute an enemy below ${threshold(COOP_DEFENSE_AFFIX_RULES.cullingHpThreshold)} HP (bosses excluded)`;
    case 'primary_slow': return locale === 'de'
      ? `${percent} Chance bei Primärwaffentreffern: Ziel ist ${seconds(COOP_DEFENSE_AFFIX_RULES.suppressionSlowDurationMs)} lang ${formatPercent(COOP_DEFENSE_AFFIX_RULES.suppressionSlowFraction, locale, 0)} langsamer`
      : `${percent} chance on primary-weapon hits: Target is ${formatPercent(COOP_DEFENSE_AFFIX_RULES.suppressionSlowFraction, locale, 0)} slower for ${seconds(COOP_DEFENSE_AFFIX_RULES.suppressionSlowDurationMs)}`;
    case 'primary_kill_fire_chunks': return locale === 'de'
      ? `${percent} Chance bei einem Primärwaffen-Kill: ${COOP_DEFENSE_AFFIX_RULES.fireChunkCount} brennende Brocken landen in der Nähe`
      : `${percent} chance on a primary-weapon kill: launches ${COOP_DEFENSE_AFFIX_RULES.fireChunkCount} burning chunks nearby`;
    case 'low_hp_blood_rage': return locale === 'de'
      ? `Unter ${threshold(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} HP: +${percent} Schaden und +${formatPercent(COOP_DEFENSE_AFFIX_RULES.bloodRageLifeLeechBonus, locale, 0)} Life Leech`
      : `Below ${threshold(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} HP: +${percent} damage and +${formatPercent(COOP_DEFENSE_AFFIX_RULES.bloodRageLifeLeechBonus, locale, 0)} life leech`;
    case 'high_hp_damage': return locale === 'de'
      ? `Ab ${threshold(COOP_DEFENSE_AFFIX_RULES.highHpThreshold)} HP: +${percent} Schaden`
      : `At ${threshold(COOP_DEFENSE_AFFIX_RULES.highHpThreshold)} HP or above: +${percent} damage`;
    case 'adrenaline_kill_charge': return locale === 'de'
      ? `Eigene Kills geben ${seconds(COOP_DEFENSE_AFFIX_RULES.killChargeDurationMs)} lang +${percent} Adrenalinregeneration je Stapel (max. ${COOP_DEFENSE_AFFIX_RULES.killChargeMaxStacks})`
      : `Your kills grant +${percent} adrenaline regeneration per stack for ${seconds(COOP_DEFENSE_AFFIX_RULES.killChargeDurationMs)} (max. ${COOP_DEFENSE_AFFIX_RULES.killChargeMaxStacks})`;
    case 'adrenaline_from_damage': return locale === 'de'
      ? `${percent} des tatsächlich erlittenen Schadens werden als Adrenalin gutgeschrieben`
      : `${percent} of actual damage taken becomes adrenaline`;
    case 'dash_speed': return locale === 'de'
      ? `Nach einem Dash ${seconds(COOP_DEFENSE_AFFIX_RULES.afterburnerDurationMs)} lang +${percent} Bewegungsgeschwindigkeit`
      : `Gain +${percent} move speed for ${seconds(COOP_DEFENSE_AFFIX_RULES.afterburnerDurationMs)} after a Dash`;
    case 'low_hp_speed': return locale === 'de'
      ? `Unter ${threshold(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} HP: +${percent} Bewegungsgeschwindigkeit`
      : `Below ${threshold(COOP_DEFENSE_AFFIX_RULES.lowHpThreshold)} HP: +${percent} move speed`;
    case 'movement_charge_damage': return locale === 'de'
      ? `Je ${COOP_DEFENSE_AFFIX_RULES.movementChargeDistancePx} zurückgelegte Pixel: nächster Primärangriff +${percent} Schaden`
      : `Every ${COOP_DEFENSE_AFFIX_RULES.movementChargeDistancePx} pixels traveled: next primary attack deals +${percent} damage`;
    case 'glutwanderer': return locale === 'de'
      ? `Je ${COOP_DEFENSE_AFFIX_RULES.glutwandererDistancePx} zurückgelegte Pixel: ${Math.max(1, Math.floor(value))} brennende Brocken`
      : `Every ${COOP_DEFENSE_AFFIX_RULES.glutwandererDistancePx} pixels traveled: ${Math.max(1, Math.floor(value))} burning chunks`;
    default: return number;
  }
}
