import type { CombatAoeDamageOptions, CombatDamageEffectPort } from '../combat/CombatCapabilities';
import type { CombatSource } from '../combat/CombatScope';
import type { BaseManager } from '../entities/BaseManager';
import { computeRadialDamage } from '../utils/radialDamage';
import { applyRadialEnvironmentDamage, type EnvironmentRockSink } from './EnvironmentDamageResolver';

export interface AreaStrikeDamage {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly maxDamage: number;
  readonly minDamage: number;
  readonly attackerId: string;
  readonly sourceId: string;
  readonly source?: CombatSource;
  readonly aoe: CombatAoeDamageOptions;
  readonly includeSelf: boolean;
  readonly friendlyBaseDamageMult: number;
  readonly rockDamageMult: number;
  /** Absent preserves airstrike's shared rock/construction multiplier. */
  readonly constructionDamageMult?: number;
  readonly trainDamageMult: number;
}

export interface AreaStrikeDamagePorts {
  readonly combat: Pick<CombatDamageEffectPort, 'applyAoeDamage'>;
  readonly bases: Pick<BaseManager, 'getBasesByFaction'> | null;
  readonly damageBase: (baseId: string, damage: number, multiplier: number) => void;
  readonly environment: EnvironmentRockSink | null;
  readonly isConstruction: (id: number) => boolean;
  readonly trainSegments: readonly { x: number; y: number }[];
  readonly damageTrain: (damage: number) => void;
  readonly damageDecoys?: (x: number, y: number, radius: number, damageAt: (distance: number) => number) => void;
}

/** Shared airstrike/mortar application; central combat and mutation paths own all target rules. */
export function applyHostileAreaStrikeDamage(request: AreaStrikeDamage, ports: AreaStrikeDamagePorts): void {
  const { x, y, radius, maxDamage, attackerId } = request;
  const falloff = { minDamage: request.minDamage };
  const damageAt = (distance: number) => computeRadialDamage(distance, radius, maxDamage, falloff);
  ports.combat.applyAoeDamage(x, y, radius, maxDamage, attackerId, request.includeSelf, {
    ...request.aoe, category: 'explosion', sourceId: request.sourceId,
    damageFalloff: falloff, source: request.source,
  });
  if (request.friendlyBaseDamageMult > 0) {
    for (const base of ports.bases?.getBasesByFaction('friendly') ?? []) {
      if (base.isInert?.() === true) continue;
      let distance = Infinity;
      for (const cell of base.getCellBodies()) {
        const b = cell.getBounds();
        const dx = Math.max(b.left - x, 0, x - b.right);
        const dy = Math.max(b.top - y, 0, y - b.bottom);
        distance = Math.min(distance, Math.sqrt(dx * dx + dy * dy));
      }
      if (distance > radius) continue;
      const damage = damageAt(distance);
      if (damage > 0) ports.damageBase(base.id, damage, request.friendlyBaseDamageMult);
    }
  }
  if (ports.environment) {
    const sink = ports.environment;
    if (request.constructionDamageMult === undefined) {
      applyRadialEnvironmentDamage(sink, { x, y, radius, damage: maxDamage, rockDamageMult: request.rockDamageMult, falloff }, attackerId, false);
    } else {
      for (const construction of [false, true]) {
        const multiplier = construction ? request.constructionDamageMult : request.rockDamageMult;
        applyRadialEnvironmentDamage({ ...sink, resolveRockDamage: (id, damage, ownerId) =>
          ports.isConstruction(id) === construction ? sink.resolveRockDamage(id, damage, ownerId) : 0,
        }, { x, y, radius, damage: maxDamage, rockDamageMult: multiplier, falloff }, attackerId, false);
      }
    }
  }
  if (request.trainDamageMult !== 0) {
    let distance = Infinity;
    for (const segment of ports.trainSegments) {
      const dx = x - segment.x;
      const dy = y - segment.y;
      distance = Math.min(distance, Math.sqrt(dx * dx + dy * dy));
    }
    if (distance <= radius) ports.damageTrain(Math.round(damageAt(distance) * request.trainDamageMult));
  }
  ports.damageDecoys?.(x, y, radius, damageAt);
}
