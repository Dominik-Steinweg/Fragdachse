import { resolveTimeBubblePrismEmitter } from '../loadout/TimeBubbleConfig';
import { MG_TURRET_RULES } from '../config/mgTurretRules';
import { getDomainCatalog, getDomainKeys, translate, translateSegments, type TranslationSegment } from './catalog';
import { formatNumber, formatUpgradeEffectValue } from './format';
import type { Locale } from './types';
import { VULNERABILITY_INCOMING_DAMAGE_BONUS } from '../systems/TargetStatusSystem';
import { UTILITY_CONFIGS } from '../loadout/LoadoutConfig';
import { getCoopDefenseUpgradeDefinition, type CoopDefenseUpgradeDefinition } from '../utils/coopDefenseUpgrades';
import {
  COOP_DEFENSE_CONSTRUCTION_BASE_SLOTS,
  COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS,
  COOP_DEFENSE_CONSTRUCTIONS,
  COOP_DEFENSE_REPAIR_DRONE_CONFIG,
  COOP_DEFENSE_UTILITY_CAPACITY_COSTS,
} from '../config/coopDefenseConstructions';

function upgradeText(key: string, locale: Locale): string {
  return getDomainCatalog('en', 'upgrades')[key] === undefined ? `⟦${key}⟧` : translate(locale, key);
}

function getUpgradeParams(
  definition: CoopDefenseUpgradeDefinition,
  locale: Locale,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    mgDuration: MG_TURRET_RULES.durationMs / 1000,
    mgPercentBasis: 100,
    mgRadius: MG_TURRET_RULES.transferRadius,
    mgBaseMaximum: MG_TURRET_RULES.baseMaximumPercent,
    maxLevel: formatNumber(definition.maxLevel, locale, { useGrouping: false }),
  };
  definition.effects.forEach((effect, index) => {
    params[`value${index}`] = formatUpgradeEffectValue(effect, locale);
    params[`value${index}Unsigned`] = formatUpgradeEffectValue(effect, locale, 'unsigned');
    params[`value${index}Absolute`] = formatUpgradeEffectValue(
      { ...effect, value: Math.abs(effect.value) },
      locale,
      'unsigned',
    );
    params[`maxValue${index}`] = formatUpgradeEffectValue(
      { ...effect, value: effect.value * definition.maxLevel },
      locale,
      'unsigned',
    );
  });

  const zeus = UTILITY_CONFIGS.ZEUS_TASER;
  if (definition.id.startsWith('zeus_') && zeus.activation.type === 'charged_alternate') {
    params.zeusChargeSeconds = formatNumber(zeus.activation.fullChargeDuration / 1000, locale);
  }
  const stink = UTILITY_CONFIGS.STINK_CLOUD;
  if ((definition.id.startsWith('stink_cloud_') || definition.id === 'unlock_stink_cloud') && stink?.type === 'stinkcloud' && stink.plague) {
    const p = stink.plague;
    params.cloudSeconds = formatNumber(stink.cloudDuration / 1000, locale);
    params.cloudTick = formatNumber(stink.cloudTickInterval / 1000, locale);
    params.cloudDamage = formatNumber(stink.cloudDamagePerTick, locale);
    params.cloudRadius = formatNumber(stink.cloudRadius, locale);
    params.cloudCooldown = formatNumber(stink.cooldown / 1000, locale);
    params.plagueDamage = formatNumber(p.damagePerTick, locale);
    params.plagueTick = formatNumber(p.tickIntervalMs / 1000, locale);
    params.plagueGenerationDuration = formatNumber(p.generationDurationFactor, locale, { style: 'percent' });
    params.contactGap = formatNumber(p.contactGap, locale);
    params.plagueSearchRadius = formatNumber(p.searchRadius, locale);
    params.plaguePursuitSpeed = formatNumber(p.pursuitMoveSpeedBonus, locale, { style: 'percent' });
    params.plagueVulnerability = formatNumber(VULNERABILITY_INCOMING_DAMAGE_BONUS, locale, { style: 'percent' });
  }
  const decoy = UTILITY_CONFIGS.DECOY;
  const translocator = UTILITY_CONFIGS.TRANSLOCATOR;
  if (definition.id.startsWith('translocator_') && translocator?.type === 'translocator') {
    params.phaseMoveSeconds = formatNumber(translocator.phaseMoveDurationMs / 1000, locale);
    params.phaseRegenSeconds = formatNumber(translocator.phaseRegenDurationMs / 1000, locale);
    params.portalSeconds = formatNumber(translocator.portalDurationMs / 1000, locale);
    params.collapseSeconds = formatNumber(translocator.collapseSlowDurationMs / 1000, locale);
    if (definition.id === 'translocator_rift_collapse') {
      params.collapseRadii = Array.from({ length: definition.maxLevel }, (_, index) =>
        formatNumber(translocator.collapseRadius + definition.effects[0].value * (index + 1), locale)).join(' / ');
    }
  }
  const timeBubble = UTILITY_CONFIGS.TIME_BUBBLE;
  if (definition.id === 'time_bubble_prism_spiral' && timeBubble?.type === 'time_bubble' && timeBubble.prismEmitter) {
    const prism = timeBubble.prismEmitter;
    params.prismIntervalsMs = Array.from({ length: definition.maxLevel }, (_, index) =>
      formatNumber(resolveTimeBubblePrismEmitter({ ...prism, level: index + 1 })!.intervalMs, locale)).join(' / ');
    params.prismRotationSeconds = formatNumber(prism.rotationPeriodMs / 1000, locale);
    params.prismDamage = formatNumber(prism.damage, locale);
    params.prismSlowPercent = formatNumber(prism.slowFraction, locale, { style: 'percent' });
    params.prismSlowSeconds = formatNumber(prism.slowDurationMs / 1000, locale);
  }
  if (definition.id === 'time_bubble_overcharge' && timeBubble?.type === 'time_bubble') {
    const capacity = (timeBubble.chargeCapacity ?? 0)
      + (getCoopDefenseUpgradeDefinition('time_bubble_resonance')?.effects[0].value ?? 0);
    params.resonanceCapacities = Array.from({ length: definition.maxLevel }, (_, i) =>
      formatNumber(capacity + definition.effects[0].value * (i + 1), locale)).join(' / ');
  }
  if (definition.id === 'time_bubble_resonance_flow') {
    params.flowPercent = formatNumber(definition.effects[0].value, locale, { style: 'percent', maximumFractionDigits: 2 });
  }
  if (definition.id.startsWith('decoy_') && decoy?.type === 'decoy') {
    params.decoyRefundSeconds = formatNumber(decoy.refundPerEnemyMs / 1000, locale);
    params.decoyChunkSeconds = formatNumber(decoy.fireChunkBurst.durationMs / 1000, locale);
  }
  const smoke = UTILITY_CONFIGS.SMOKE_GRENADE;
  if (definition.id.startsWith('smoke_grenade_') && smoke?.type === 'smoke') {
    params.smokeVulnerability = formatNumber(VULNERABILITY_INCOMING_DAMAGE_BONUS, locale, { style: 'percent' });
    params.smokeChargeSeconds = formatNumber(smoke.smokeBehavior.chargeDurationMs / 1000, locale);
    params.smokeStormTick = formatNumber(smoke.smokeDotTickIntervalMs / 1000, locale);
    params.smokeDischargeCooldown = formatNumber(smoke.smokeBehavior.dischargeCooldownMs / 1000, locale);
    if (definition.id === 'smoke_grenade_disorientation') {
      const stages = Array.from({ length: definition.maxLevel }, (_, i) => i + 1);
      params.smokeConfusionStages = stages.map(level => formatNumber(smoke.smokeBehavior.confusionFraction + definition.effects[0].value * level, locale, { style: 'percent' })).join(' / ');
      params.smokeAftereffectStages = stages.map(level => formatNumber((smoke.smokeBehavior.aftereffectMs + definition.effects[1].value * level) / 1000, locale)).join(' / ');
    }
    params.smokeGrowthSeconds = formatNumber(smoke.smokeBehavior.growthDurationMs / 1000, locale);
    params.smokeGrowthRadius = formatNumber(smoke.smokeBehavior.growthRadiusFraction, locale, { style: 'percent' });
  }
  const he = UTILITY_CONFIGS.HE_GRENADE;
  if (definition.id.startsWith('he_grenade_') && he?.type === 'explosive' && he.fragmentation) {
    const percent = (value: number) => formatNumber(value, locale, { style: 'percent', maximumFractionDigits: 1 });
    const duration = (value: number) => `${formatNumber(value / 1000, locale)} s`;
    const range = (values: readonly number[]) => values.map(duration).join('–');
    params.heLockout = duration(he.charges?.burstLockoutMs ?? 0);
    params.heClusterDamage = percent(he.clusterDamageFactor ?? 0);
    params.heClusterRadius = percent(he.clusterRadiusFactor ?? 0);
    params.heClusterFuse = range(he.fragmentation.fuseMs);
    params.heDemolitionCount = formatNumber(he.fragmentation.demolition.count, locale);
    params.heDemolitionDamage = he.fragmentation.demolition.damageFactors.map(percent).join(' / ');
    params.heDemolitionRadius = percent(he.fragmentation.demolition.radiusFactor);
    params.heDemolitionFuse = range(he.fragmentation.demolition.fuseMs);
  }

  if (definition.id === 'inspector_construction_slots') {
    params.baseSlots = formatNumber(COOP_DEFENSE_CONSTRUCTION_BASE_SLOTS, locale, { useGrouping: false });
    params.maxSlots = formatNumber(COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS, locale, { useGrouping: false });
  }
  if (definition.id === 'inspector_repair_drone') {
    params.repairPerSecond = formatNumber(COOP_DEFENSE_REPAIR_DRONE_CONFIG.repairPerSecond, locale, { useGrouping: false });
  }

  const constructionId = definition.id.replace(/^unlock_/, '');
  const construction = COOP_DEFENSE_CONSTRUCTIONS[constructionId as keyof typeof COOP_DEFENSE_CONSTRUCTIONS];
  if (construction) {
    params.capacity = formatNumber(construction.capacityCost, locale, { useGrouping: false });
  }
  const utilityCapacity = COOP_DEFENSE_UTILITY_CAPACITY_COSTS[definition.loadoutUnlock?.itemId ?? ''];
  if (utilityCapacity !== undefined) {
    params.capacity = formatNumber(utilityCapacity, locale, { useGrouping: false });
  }
  return params;
}

export function getUpgradeCategoryName(id: string, locale: Locale): string {
  return upgradeText(`upgradeCategory.${id}.name`, locale);
}

export function getUpgradeCategoryDescription(id: string, locale: Locale): string {
  return upgradeText(`upgradeCategory.${id}.description`, locale);
}

export function getUpgradeName(id: string, locale: Locale): string {
  return upgradeText(`upgrade.${id}.name`, locale);
}

export function getUpgradeDescription(id: string, locale: Locale): string {
  return getUpgradeDescriptionSegments(id, locale).map((segment) => segment.text).join('');
}

export function getUpgradeDescriptionSegments(id: string, locale: Locale): readonly TranslationSegment[] {
  const definition = getCoopDefenseUpgradeDefinition(id);
  return translateSegments(
    locale,
    `upgrade.${id}.description`,
    definition ? getUpgradeParams(definition, locale) : undefined,
  );
}

export function getUpgradePresentationKeys(): readonly string[] {
  return getDomainKeys('upgrades');
}
