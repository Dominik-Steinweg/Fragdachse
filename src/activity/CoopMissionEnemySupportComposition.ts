import { CoopDefenseFirestarterSystem } from '../systems/CoopDefenseFirestarterSystem';
import { ALLIED_COLOR, PLAYER_SIZE, VOID_PALETTE } from '../config';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import { CoopDefenseMortarSystem } from '../systems/CoopDefenseMortarSystem';
import { CoopDefenseMortarStrikeSystem, type CoopDefenseMortarImpactPort } from '../systems/CoopDefenseMortarStrikeSystem';
import type { BaseManager } from '../entities/BaseManager';
import type { CombatActivityPort } from '../combat/CombatCapabilities';
import type { CoopMissionEnemySpecialRuntime, CoopMissionRuntime } from './CoopMissionRuntime';
import type { PlayerManager } from '../entities/PlayerManager';
import type { PlacementSystem } from '../systems/PlacementSystem';
import {
  CoopDefenseKaboomtulaSystem,
  type KaboomtulaContact,
  type KaboomtulaHuntTarget,
} from '../systems/CoopDefenseKaboomtulaSystem';
import { CoopDefenseTurretWebSystem, type TurretWebTarget } from '../systems/CoopDefenseTurretWebSystem';
import { KaboomtulaBlast } from '../systems/kaboomtulaBlast';
import { createEnemyLaneClearance } from '../systems/enemyLaneClearance';
import type { EnemyAiTargetRef } from '../systems/EnemyAiTargetCatalog';
import type { KaboomtulaTargetRef } from '../systems/KaboomtulaState';
import { CoopDefenseVoidHunterSystem } from '../systems/CoopDefenseVoidHunterSystem';
import { NecromancySystem } from '../systems/NecromancySystem';
import type { FireChunkBurstPort } from '../systems/FlamethrowerUpgradeSystem';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import type { ArmageddonSystem } from '../systems/ArmageddonSystem';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { CoopDefensePlayerModifierReadPort } from '../systems/CoopDefensePlayerModifierSystem';
import type { DecoySystem } from '../systems/DecoySystem';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { AutomatedWeaponExecution } from '../world/AutomatedWeaponExecutionAdapter';

export interface CoopMissionEnemySupportCompositionOptions {
  readonly projectileDetonables: import('../projectile/ProjectileGameplayPort').ProjectileDetonableReadPort | null;
  readonly mortarImpact: CoopDefenseMortarImpactPort;
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatActivityPort;
  readonly baseManager: BaseManager | null;
  readonly placementSystem: PlacementSystem;
  readonly hostPhysics: HostPhysicsSystem;
  readonly weaponExecution: AutomatedWeaponExecution;
  readonly playerFireChunkPort: FireChunkBurstPort | null;
  readonly powerUpSystem: PowerUpSystem | null;
  readonly armageddonSystem: ArmageddonSystem | null;
  readonly decoySystem: DecoySystem | null;
  readonly playerModifierReadPort: CoopDefensePlayerModifierReadPort | null;
  readonly removeEnemyFromPlayerItems: (enemyId: string) => void;
  readonly damageConstruction: (id: number, damage: number, attackerId: string) => void;
  /** Walkability of a swept body path (water, arena edge) for leap lanes. */
  readonly hasWalkableEnemyCircleLine: (fromX: number, fromY: number, toX: number, toY: number, radius: number) => boolean;
  /** Friendly turrets a Kabummtula may web. */
  readonly getTurretWebTargets: () => readonly TurretWebTarget[];
  readonly broadcastExplosion: (
    x: number,
    y: number,
    radius: number,
    style: 'timebomb' | 'timebomb_pop' | 'mortar',
    color?: number,
  ) => void;
  readonly broadcastCorpseMarker: (
    corpseId: number,
    x: number,
    y: number,
    enemySize: number,
    lifetimeMs: number,
  ) => void;
  readonly removeCorpseMarker: (corpseId: number) => void;
  readonly onDiagnosticEvent?: (type: string, fields: Record<string, unknown>) => void;
  readonly worldMetrics: WorldMetrics;
}

/** Materializes Activity-owned specials, necromancy and their stale-callback guards. */
export class CoopMissionEnemySupportComposition {
  constructor(private readonly options: CoopMissionEnemySupportCompositionOptions) {}

  materialize(runtime: CoopMissionRuntime): void {
    const enemyManager = runtime.enemyManager;
    const strategicTargets = runtime.enemyStrategicTargetService;
    const strategicFlowField = runtime.enemyStrategicFlowFieldService;
    const burrow = runtime.coopDefenseEnemyBurrowSystem;
    if (!enemyManager) throw new Error('[CoopMissionEnemySupportComposition] EnemyManager is missing');

    const catalog = runtime.enemyAiTargetCatalog, intents = runtime.enemyIntents;
    const kaboomtulaParts = catalog && intents ? this.createKaboomtula(runtime, catalog, intents) : null;

    const voidHunter = enemyManager
      && burrow
      && this.options.playerFireChunkPort
      && this.options.weaponExecution
      && this.options.powerUpSystem
      && this.options.armageddonSystem
      ? new CoopDefenseVoidHunterSystem(
        enemyManager,
        this.options.playerManager,
        this.options.combatSystem,
        this.options.weaponExecution,
        this.options.powerUpSystem,
        this.options.armageddonSystem,
        burrow,
        this.options.playerFireChunkPort,
        runtime.enemyAiTargetCatalog,
        (phase) => this.options.onDiagnosticEvent?.('boss:phase', { phase }),
        this.options.worldMetrics,
      )
      : null;

    voidHunter?.setDecoyTargets(runtime.coopDefenseDecoyTargetSystem);
    if (kaboomtulaParts || voidHunter) {
      const specials: CoopMissionEnemySpecialRuntime = { kaboomtula: kaboomtulaParts?.kaboomtula ?? null,
        turretWeb: kaboomtulaParts?.turretWeb ?? null, voidHunter };
      runtime.setEnemySpecials(specials);
    }

    if (runtime.enemyAiTargetCatalog) {
      const strikes = new CoopDefenseMortarStrikeSystem({ impact: (strike, nowMs) => {
        this.options.mortarImpact.impact(strike, nowMs);
        const shot = strike.snapshot;
        this.options.broadcastExplosion(shot.targetX, shot.targetY, shot.radius, 'mortar', shot.faction === 'allied' ? ALLIED_COLOR : VOID_PALETTE.primary);
      } });
      runtime.setMortar(new CoopDefenseMortarSystem(enemyManager, this.options.playerManager,
        this.options.combatSystem, runtime.enemyAiTargetCatalog, this.options.baseManager,
        this.options.placementSystem, strikes, strategicFlowField), strikes);
    }

    if (runtime.enemyAiTargetCatalog && this.options.projectileDetonables) {
      runtime.setFirestarter(new CoopDefenseFirestarterSystem(enemyManager, this.options.combatSystem,
        this.options.weaponExecution, this.options.projectileDetonables, runtime.enemyAiTargetCatalog,
        runtime.coopDefenseEnemyDodgeSystem ?? undefined));
    }

    const necromancy = this.options.playerModifierReadPort && this.options.weaponExecution
      ? new class extends NecromancySystem {
        override recordEnemyDeath(death: Parameters<NecromancySystem['recordEnemyDeath']>[0], now?: number): void {
          if (!runtime.kraken?.excluded.has(death.id)) super.recordEnemyDeath(death, now);
        }
      }(
        this.options.playerManager,
        enemyManager,
        this.options.combatSystem,
        this.options.weaponExecution,
        runtime.allyFlowFields,
        (playerId, stat, baseValue) => this.options.playerModifierReadPort?.getResolvedStat(playerId, stat, baseValue) ?? baseValue,
      )
      : null;
    necromancy?.setSpecialMovementSource(() => runtime.enemySpecialMovementSource);
    if (necromancy) runtime.setNecromancy(necromancy);

    if (!necromancy && !runtime.coopDefenseEnemyAttackSystem) return;
    runtime.bind({
      attach: () => {
        // Raised charger shields block in combat and replicate for this Activity's lifetime.
        this.options.combatSystem.setEnemyFrontalShieldPort?.(runtime.coopDefenseShieldChargerSystem);
        runtime.coopDefenseEnemyAttackSystem?.setActionBlockedChecker((enemyId) => (
          (runtime.coopDefenseVoidHunterSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseKaboomtulaSystem?.blocksRegularBehavior(enemyId) ?? false)
          || (runtime.coopDefenseMortarSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseFirestarterSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseShieldChargerSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseEnergyConeSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseEnemyHopSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseEnemyAbilitySystem?.blocksRegularAttacks(enemyId) ?? false)
        ));
        runtime.coopDefenseEnemyDodgeSystem?.setBlockedChecker(enemyId =>
          (runtime.coopDefenseVoidHunterSystem?.blocksDodge(enemyId) ?? false)
          || (runtime.coopDefenseFirestarterSystem?.blocksDodge(enemyId) ?? false)
          || (runtime.coopDefenseShieldChargerSystem?.blocksDodge(enemyId) ?? false)
          || (runtime.coopDefenseEnergyConeSystem?.blocksDodge(enemyId) ?? false)
          || (runtime.coopDefenseEnemyHopSystem?.blocksDodge(enemyId) ?? false));
        if (necromancy) {
          necromancy.setCorpseSink({
            onCorpseAdded: (corpseId, x, y, enemySize, lifetimeMs) => {
              this.options.broadcastCorpseMarker(corpseId, x, y, enemySize, lifetimeMs);
            },
            onCorpseRemoved: (corpseId) => this.options.removeCorpseMarker(corpseId),
          });
          enemyManager.setLethalDamageGuard((currentEnemy) => (
            runtime.kraken?.excluded.has(currentEnemy.id) ? { kind: 'allow-death' as const } : necromancy.handleLethalDamage(currentEnemy)
          ));
        }
      },
      detach: () => {
        this.options.combatSystem.setEnemyFrontalShieldPort?.(null);
        runtime.coopDefenseEnemyAttackSystem?.setActionBlockedChecker(null);
        runtime.coopDefenseEnemyDodgeSystem?.setBlockedChecker(null);
        if (necromancy) {
          necromancy.setCorpseSink(null);
          enemyManager.setLethalDamageGuard(null);
        }
      },
    });
  }

  /** Kabummtula and its turret webs, bound to the shared intents, decoys and combat geometry. */
  private createKaboomtula(runtime: CoopMissionRuntime, catalog: NonNullable<CoopMissionRuntime['enemyAiTargetCatalog']>,
    intents: NonNullable<CoopMissionRuntime['enemyIntents']>):
    { kaboomtula: CoopDefenseKaboomtulaSystem; turretWeb: CoopDefenseTurretWebSystem } {
    const enemyManager = runtime.enemyManager!, combat = this.options.combatSystem, placement = this.options.placementSystem;
    const bases = this.options.baseManager, decoys = this.options.decoySystem;
    const blast = new KaboomtulaBlast({
      playerManager: this.options.playerManager, baseManager: bases, placementSystem: placement, combat, catalog,
      decoySystem: decoys, fireChunks: this.options.playerFireChunkPort,
      hooks: {
        playExplosion: (x, y, radius, style) => this.options.broadcastExplosion(x, y, radius, style),
        applyRadialImpulse: (x, y, radius, force, ownerId) => this.options.hostPhysics.applyRadialImpulse(x, y, radius, force, ownerId, 0),
        damageConstruction: this.options.damageConstruction,
        removeWithoutKill: enemyId => enemyManager.hostRemoveWithoutKill(enemyId),
        onSelfDetonated: enemyId => this.options.removeEnemyFromPlayerItems(enemyId),
      },
    });
    const turretWeb = new CoopDefenseTurretWebSystem({
      turrets: this.options.getTurretWebTargets,
      // Reverse sight: a spider may web exactly the turrets that could see it.
      canSee: (turret, x, y) => combat.hasClearLineOfFire(turret.x, turret.y, x, y,
        { skipRockIndex: turret.skipRockIndex, sourceCarrierBaseId: turret.sourceCarrierBaseId }),
    });
    const hunt = (enemy: { sprite: { x: number; y: number } }, ref: EnemyAiTargetRef | { kind: 'base'; id: string }):
      KaboomtulaHuntTarget | null => {
      const fromX = enemy.sprite.x, fromY = enemy.sprite.y;
      if (ref.kind === 'decoy') {
        const decoy = decoys?.getHostTarget(Number(ref.id));
        return decoy && decoy.hp > 0 ? { ref: { kind: 'decoy', id: String(decoy.id) }, x: decoy.x, y: decoy.y,
          radius: decoy.radius, pounceable: true } : null;
      }
      if (ref.kind === 'base') {
        const base = bases?.getBase(ref.id);
        const surface = base && base.getHp() > 0 && !base.isInert() ? base.getNearestSurfacePoint(fromX, fromY) : null;
        return surface ? { ref: { kind: 'base', id: ref.id }, x: surface.x, y: surface.y, radius: 0, pounceable: false,
          baseId: ref.id } : null;
      }
      const resolved = catalog.resolve(ref), position = resolved ? catalog.getPosition(ref, fromX, fromY) : null;
      if (!resolved || !position) return null;
      if (ref.kind === 'player') return { ref: { kind: 'player', id: ref.id }, x: position.x, y: position.y,
        radius: PLAYER_SIZE / 2, pounceable: true };
      // A structure that represents players inside it is rammed at its surface.
      return { ref: { kind: 'structure', id: `${ref.kind}:${ref.id}` }, x: position.x, y: position.y, radius: 0,
        pounceable: false, skipRockIndex: resolved.skipRockIndex, baseId: ref.kind === 'armed-construct' ? undefined : ref.id };
    };
    const fromRef = (ref: KaboomtulaTargetRef): EnemyAiTargetRef | { kind: 'base'; id: string } | null => {
      if (ref.kind === 'player' || ref.kind === 'decoy' || ref.kind === 'base') return { kind: ref.kind, id: ref.id };
      if (ref.kind !== 'structure') return null;
      const split = ref.id.indexOf(':');
      return split > 0 ? { kind: ref.id.slice(0, split) as EnemyAiTargetRef['kind'], id: ref.id.slice(split + 1) } : null;
    };
    const kaboomtula = new CoopDefenseKaboomtulaSystem({
      enemies: enemyManager,
      isStunned: (enemyId, now) => combat.isStunned?.(enemyId, now) ?? false,
      readTarget: enemy => {
        const decoy = runtime.coopDefenseDecoyTargetSystem?.getTarget(enemy.id);
        if (decoy) return hunt(enemy, decoy);
        const target = intents.get(enemy.id)?.target;
        if (!target || target.kind === 'ally') return null;
        return hunt(enemy, target.kind === 'base' ? { kind: 'base', id: target.id } : target as EnemyAiTargetRef);
      },
      resolveTarget: (enemy, ref) => { const source = fromRef(ref); return source ? hunt(enemy, source) : null; },
      canSee: (enemy, target, range) => {
        const x = enemy.sprite.x, y = enemy.sprite.y;
        return Math.hypot(target.x - x, target.y - y) <= range && enemyManager.canSeeThroughSmoke(enemy.id, target.x, target.y, range)
          && combat.hasLineOfSight(x, y, target.x, target.y, target.skipRockIndex, target.baseId);
      },
      contactTargets: (enemy, hunted) => {
        const contacts: KaboomtulaContact[] = [], x = enemy.sprite.x, y = enemy.sprite.y;
        for (const player of this.options.playerManager.getAllPlayers()) {
          if (!player.active || !combat.isAlive(player.id) || combat.isBurrowed(player.id)) continue;
          const structureId = combat.getStructureOccupancyId?.(player.id);
          const structure = structureId === undefined ? null : placement.getRuntimeRock(structureId);
          if (structure) {
            const surface = placement.getRuntimeRockSurfacePoint(structure, x, y);
            contacts.push({ ref: { kind: 'player', id: player.id }, x: surface.x, y: surface.y, radius: 0 });
          } else contacts.push({ ref: { kind: 'player', id: player.id }, x: player.x, y: player.y, radius: PLAYER_SIZE / 2 });
        }
        for (const decoy of decoys?.getHostTargets() ?? []) {
          if (decoy.hp > 0) contacts.push({ ref: { kind: 'decoy', id: String(decoy.id) }, x: decoy.x, y: decoy.y, radius: decoy.radius });
        }
        // A base only counts while it is the hunted kamikaze target; passing spiders do not explode on walls.
        const base = hunted?.kind === 'base' ? bases?.getBase(hunted.id) : null;
        const surface = base && base.getHp() > 0 ? base.getNearestSurfacePoint(x, y) : null;
        if (surface) contacts.push({ ref: { kind: 'base', id: base!.id }, x: surface.x, y: surface.y, radius: 0 });
        return contacts;
      },
      laneClearance: createEnemyLaneClearance(combat, this.options.hasWalkableEnemyCircleLine),
      route: (enemy, key, point, range) => {
        const route = enemyManager.routeAlly(enemy, key, point, range);
        if (!route) return null;
        if (route.status === 'ready') return route.waypoint;
        return route.status === 'pending' ? route.continuation ?? null : null;
      },
      moveNormally: (enemy, point, speed, aimAngle) => {
        const result = enemyManager.moveNormally(enemy, point, speed, aimAngle);
        return { vx: result.vx, vy: result.vy, blocked: result.waitReason !== 'none' };
      },
      onCommit: (enemy, ref) => {
        if (ref.kind === 'decoy') runtime.coopDefenseDecoyTargetSystem?.usedTarget(enemy.id, { kind: 'decoy', id: ref.id });
      },
      detonate: (enemy, contact, now) => {
        const config = getCoopDefenseEnemyConfig(enemy.kind).kaboomtula;
        if (config) blast.detonate(enemy, config, contact, now);
      },
      killedPop: death => {
        const config = getCoopDefenseEnemyConfig(death.kind).kaboomtula;
        if (config) blast.killedPop(death, config);
      },
      web: turretWeb,
      sound: () => { /* intentionally unmapped */ },
    });
    return { kaboomtula, turretWeb };
  }

}
