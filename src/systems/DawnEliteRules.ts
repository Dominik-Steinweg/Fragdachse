import { DAWN_ELITE_CONFIG, type DawnEliteConfig } from '../config/dawn/elites';
import { DAWN_ELITE_AFFIX_IDS, type DawnEliteAffixId } from '../dawn/contracts/DawnContentIds';
import { hashCanonicalJson } from '../dawn/contracts/dawnCanonicalJson';
import type { ProjectileExplosionConfig } from '../types';

export interface DawnEliteSpawnContext {
  readonly roundSeed: number;
  readonly threat: number;
}

/** Independent per-enemy draws: retries and other random consumers cannot advance this stream. */
export function rollDawnElite(context: DawnEliteSpawnContext, encounterId: string, enemyId: string,
  config: DawnEliteConfig = DAWN_ELITE_CONFIG): DawnEliteAffixId | undefined {
  const chance = config.chanceByThreat[context.threat - 1];
  if (chance === undefined) throw new Error(`[DawnElite] Invalid threat ${context.threat}`);
  const roll = (stream: string) => parseInt(hashCanonicalJson([context.roundSeed, encounterId, enemyId, stream]).slice(-8), 16) / 0x100000000;
  if (roll('elite-chance') >= chance) return undefined;
  let weight = roll('elite-affix') * DAWN_ELITE_AFFIX_IDS.reduce((sum, id) => sum + config.affixes[id].weight, 0);
  for (const id of DAWN_ELITE_AFFIX_IDS) {
    weight -= config.affixes[id].weight;
    if (weight < 0) return id;
  }
  return undefined;
}

export function dawnEliteSpeedMultiplier(affix: DawnEliteAffixId | undefined): number {
  return affix === 'swift' ? DAWN_ELITE_CONFIG.affixes.swift.speedMultiplier : 1;
}

export interface DawnEliteTarget {
  readonly id: string;
  readonly eliteAffixId?: DawnEliteAffixId;
  readonly faction: 'hostile' | 'allied';
  readonly sprite: { readonly x: number; readonly y: number; readonly active: boolean };
  getHp(): number;
  isBurrowed(): boolean;
}

/** Armor and one nearby shield multiply; shields never stack or protect their own emitter. */
export function dawnEliteDamageMultiplier(target: DawnEliteTarget, shields: Iterable<DawnEliteTarget>): number {
  const { armored, shielding } = DAWN_ELITE_CONFIG.affixes;
  let multiplier = target.eliteAffixId === 'armored' ? 1 - armored.damageReduction : 1;
  if (target.faction !== 'hostile') return multiplier;
  for (const shield of shields) {
    if (shield.id === target.id || shield.faction !== target.faction || shield.eliteAffixId !== 'shielding'
      || !shield.sprite.active || shield.getHp() <= 0 || shield.isBurrowed()) continue;
    const dx = shield.sprite.x - target.sprite.x, dy = shield.sprite.y - target.sprite.y;
    if (dx * dx + dy * dy <= shielding.radiusPx ** 2) {
      multiplier *= 1 - shielding.damageReduction;
      break;
    }
  }
  return multiplier;
}

export function dawnEliteRegeneration(affix: DawnEliteAffixId | undefined, maxHp: number, deltaMs: number): number {
  return affix === 'regenerating' && Number.isFinite(deltaMs) && deltaMs > 0
    ? maxHp * DAWN_ELITE_CONFIG.affixes.regenerating.maxHpFractionPerSecond * deltaMs / 1000 : 0;
}

export function dawnEliteDeathExplosion(affix: DawnEliteAffixId | undefined): ProjectileExplosionConfig | null {
  if (affix !== 'volatile') return null;
  const config = DAWN_ELITE_CONFIG.affixes.volatile;
  return { radius: config.radiusPx, maxDamage: config.damage, minDamage: config.minDamage,
    knockback: config.knockback, selfDamageMult: 0, damageTarget: 'player-side',
    visualStyle: 'timebomb_pop', rockDamageMult: 1, baseDamageMult: 1, trainDamageMult: 0 };
}
