import type { CombatSource } from '../combat/CombatScope';
import type { WorldCombatCore } from '../combat/WorldCombatCore';
import { BomberSquadronRuntime, type BomberSquadronBombEvent, type BomberSquadronRuntimeDeps } from '../systems/bomberSquadron/BomberSquadronRuntime';
import { bomberWorldBoundsFromMetrics, type BomberAimTarget } from '../systems/bomberSquadron/BomberSquadronPlan';
import { CELL_SIZE } from '../config';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { BaseManager } from '../entities/BaseManager';
import { computeExposedBaseFaces, type ExposedBaseFaceCache } from '../systems/TurretBaseTargeting';
import type { ProjectileDamageSourceFactor, ProjectileExplosionConfig } from '../types';
import { attackDroneFireChunkProfile } from './AttackDroneFireChunkProfile';
import type { PlayerCombatIntegrationPort } from './PlayerCombatIntegrationPort';
import type { WorldMetrics } from './WorldMetrics';

const SOURCE = { bomb: 'BOMBER_SQUADRON', fire: 'BOMBER_SQUADRON.fire', chunk: 'BOMBER_SQUADRON.chunk' } as const;

/** Lebende Feinde und jede freiliegende feindliche Basiszelle genau einmal. */
export function readBomberAimTargets(
  enemies: readonly EnemyEntity[], bases: BaseManager | null, metrics: WorldMetrics, cache: ExposedBaseFaceCache,
): readonly BomberAimTarget[] {
  const targets: BomberAimTarget[] = [];
  for (const enemy of enemies) if (enemy.sprite.active && enemy.faction === 'hostile' && enemy.getHp() > 0) {
    targets.push({ x: enemy.sprite.x, y: enemy.sprite.y, weight: 1 });
  }
  for (const base of bases?.getBasesByFaction('hostile') ?? []) {
    if (!base.isDamageable() || base.isInert() || base.getHp() <= 0) continue;
    const faces = cache.get(base.id, bases!.getObstacleGeneration(), () => computeExposedBaseFaces({
      cells: base.getSpec().cells, cellSize: CELL_SIZE, offsetX: metrics.offsetX, offsetY: metrics.offsetY,
      isCoveredCell: () => false,
    }));
    const cells = new Set<string>();
    for (const face of faces) {
      const x = (face.x1 + face.x2 - face.normalX * CELL_SIZE) / 2;
      const y = (face.y1 + face.y2 - face.normalY * CELL_SIZE) / 2;
      const key = `${x},${y}`;
      if (!cells.has(key)) { cells.add(key); targets.push({ x, y, weight: 0.5 }); }
    }
  }
  return targets;
}
interface CapturedBomb {
  readonly source: CombatSource;
  readonly multiplier: number;
  readonly factors: readonly ProjectileDamageSourceFactor[];
  readonly squadronId: number;
}
export interface WorldBomberSquadronOptions {
  readonly combat: WorldCombatCore;
  readonly playerCombat: PlayerCombatIntegrationPort;
  readonly metrics: WorldMetrics;
  readonly readOwner: BomberSquadronRuntimeDeps['readOwner'];
  readonly readTargets: BomberSquadronRuntimeDeps['readTargets'];
}

/** World adapter: captures outgoing power at drop time and executes deterministic impacts. */
export class WorldBomberSquadronBinding {
  readonly runtime: BomberSquadronRuntime;
  private readonly bombs = new Map<string, CapturedBomb>();
  private generation = 0;

  constructor(private readonly options: WorldBomberSquadronOptions) {
    this.runtime = new BomberSquadronRuntime({ readOwner: options.readOwner, readTargets: options.readTargets,
      worldBounds: () => bomberWorldBoundsFromMetrics(options.metrics) });
  }

  advance(now: number): void {
    const generation = this.generation;
    for (const event of this.runtime.update(now)) {
      if (generation !== this.generation) break;
      this.options.combat.runHostExecution(() => {
        if (event.kind === 'drop') this.capture(event);
        else this.impact(event);
      }, event.at);
    }
    const active = new Set(this.runtime.getSnapshot().squadrons.map(squadron => squadron.id));
    for (const [key, bomb] of this.bombs) if (!active.has(bomb.squadronId)) this.bombs.delete(key);
  }

  clear(): void { this.generation++; this.runtime.clear(); this.bombs.clear(); }
  destroy(): void { this.clear(); }

  private capture(event: BomberSquadronBombEvent): void {
    const combat = this.options.combat;
    const multiplier = combat.getPlayerRuntimeDamageMultiplier(event.ownerId, 'ultimate');
    const provenance = combat.captureProjectileProvenance({
      gameplaySourceId: event.bombKey, gameplaySourceKind: 'turret',
      attributionId: event.ownerId, attributionKind: 'player',
      allegiance: { ownerId: event.ownerId, kind: 'player', allowTeamDamage: false },
      weaponSourceId: SOURCE.bomb, sourceSlot: 'ultimate', correlation: { executionId: event.bombKey },
    });
    this.bombs.set(event.bombKey, { squadronId: event.squadronId, multiplier,
      factors: [{ kind: 'runtime-power', multiplier, resolvedAt: 'execution' }],
      source: combat.captureWorldDamageSource(event.ownerId, SOURCE.bomb, 'explosion', provenance) });
  }

  private impact(event: BomberSquadronBombEvent): void {
    const captured = this.bombs.get(event.bombKey);
    if (!captured) return;
    this.bombs.delete(event.bombKey);
    const { multiplier, source, factors } = captured;
    const effect: ProjectileExplosionConfig = {
      radius: event.config.explosionRadius, maxDamage: event.config.maxDamage * multiplier,
      minDamage: event.config.minDamage * multiplier, appliedSourceDamageFactors: factors,
      damageTarget: 'enemies', excludeFriendlyPlayers: true, selfDamageMult: 0, knockback: 0,
      rockDamageMult: 0, trainDamageMult: 0, baseDamageMult: 1, useTargetSurfaceDistance: true,
    };
    const generation = this.generation;
    this.options.combat.applyExplosionDamage(event.x, event.y, effect, event.ownerId, 'ultimate', SOURCE.bomb, source);
    if (generation !== this.generation || event.config.fireChunksPerBomb <= 0) return;
    this.options.playerCombat.fireChunks?.hostCreateFireChunkBurst(event.ownerId, event.x, event.y,
      attackDroneFireChunkProfile(event.bombKey, event.config.fireChunksPerBomb, multiplier, effect, SOURCE, true),
      event.bombKey, event.at, { ...source, authoredSourceId: SOURCE.fire, origin: 'ground',
        lineage: { ...source.lineage, parentEffectId: event.bombKey } });
  }
}
