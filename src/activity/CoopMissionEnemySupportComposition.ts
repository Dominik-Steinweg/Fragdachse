import { CoopDefenseFirestarterSystem } from '../systems/CoopDefenseFirestarterSystem';
import { ALLIED_COLOR, VOID_PALETTE } from '../config';
import { CoopDefenseMortarSystem } from '../systems/CoopDefenseMortarSystem';
import { CoopDefenseMortarStrikeSystem, type CoopDefenseMortarImpactPort } from '../systems/CoopDefenseMortarStrikeSystem';
import type { BaseManager } from '../entities/BaseManager';
import type { CombatActivityPort } from '../combat/CombatCapabilities';
import type { CoopMissionEnemySpecialRuntime, CoopMissionRuntime } from './CoopMissionRuntime';
import type { PlayerManager } from '../entities/PlayerManager';
import type { PlacementSystem } from '../systems/PlacementSystem';
import { CoopDefenseTimebombSystem as TimebombSystem } from '../systems/CoopDefenseTimebombSystem';
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

    const timebomb = enemyManager
      && strategicTargets
      && strategicFlowField
      ? new TimebombSystem(
        enemyManager,
        this.options.playerManager,
        this.options.baseManager,
        this.options.placementSystem,
        this.options.combatSystem,
        strategicTargets,
        strategicFlowField,
        this.options.playerFireChunkPort,
        {
          playExplosion: (x, y, radius, style) => this.options.broadcastExplosion(x, y, radius, style),
          applyRadialImpulse: (x, y, radius, force, ownerId) => {
            this.options.hostPhysics.applyRadialImpulse(x, y, radius, force, ownerId, 0);
          },
          damageConstruction: this.options.damageConstruction,
          onSelfDetonated: (enemyId) => this.options.removeEnemyFromPlayerItems(enemyId),
          sound: (_event) => { /* intentionally unmapped */ },
        },
        this.options.decoySystem,
      )
      : null;

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

    timebomb?.setDecoyTargets(runtime.coopDefenseDecoyTargetSystem);
    voidHunter?.setDecoyTargets(runtime.coopDefenseDecoyTargetSystem);
    if (timebomb || voidHunter) {
      const specials: CoopMissionEnemySpecialRuntime = { timebomb, voidHunter };
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
          || (runtime.coopDefenseTimebombSystem?.blocksRegularBehavior(enemyId) ?? false)
          || (runtime.coopDefenseMortarSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseFirestarterSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseShieldChargerSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseEnemyAbilitySystem?.blocksRegularAttacks(enemyId) ?? false)
        ));
        runtime.coopDefenseEnemyDodgeSystem?.setBlockedChecker(enemyId =>
          (runtime.coopDefenseVoidHunterSystem?.blocksDodge(enemyId) ?? false)
          || (runtime.coopDefenseFirestarterSystem?.blocksDodge(enemyId) ?? false)
          || (runtime.coopDefenseShieldChargerSystem?.blocksDodge(enemyId) ?? false));
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
}
