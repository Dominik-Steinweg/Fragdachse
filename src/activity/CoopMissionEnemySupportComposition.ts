import type { BaseManager } from '../entities/BaseManager';
import type { CombatSystem } from '../systems/CombatSystem';
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
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { AutomatedWeaponExecution } from '../world/AutomatedWeaponExecutionAdapter';

export interface CoopMissionEnemySupportCompositionOptions {
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatSystem;
  readonly baseManager: BaseManager;
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
    style: 'timebomb' | 'timebomb_pop',
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

    if (timebomb || voidHunter) {
      const specials: CoopMissionEnemySpecialRuntime = { timebomb, voidHunter };
      runtime.setEnemySpecials(specials);
    }

    const necromancy = this.options.playerModifierReadPort && this.options.weaponExecution
      ? new NecromancySystem(
        this.options.playerManager,
        enemyManager,
        this.options.combatSystem,
        this.options.weaponExecution,
        runtime.allyFlowFields,
        (playerId, stat, baseValue) => this.options.playerModifierReadPort?.getResolvedStat(playerId, stat, baseValue) ?? baseValue,
      )
      : null;
    if (necromancy) runtime.setNecromancy(necromancy);

    if (!necromancy && !runtime.coopDefenseEnemyAttackSystem) return;
    runtime.bind({
      attach: () => {
        runtime.coopDefenseEnemyAttackSystem?.setActionBlockedChecker((enemyId) => (
          (runtime.coopDefenseVoidHunterSystem?.blocksRegularAttacks(enemyId) ?? false)
          || (runtime.coopDefenseTimebombSystem?.blocksRegularBehavior(enemyId) ?? false)
          || (runtime.coopDefenseEnemyAbilitySystem?.blocksRegularAttacks(enemyId) ?? false)
        ));
        if (necromancy) {
          necromancy.setCorpseSink({
            onCorpseAdded: (corpseId, x, y, enemySize, lifetimeMs) => {
              this.options.broadcastCorpseMarker(corpseId, x, y, enemySize, lifetimeMs);
            },
            onCorpseRemoved: (corpseId) => this.options.removeCorpseMarker(corpseId),
          });
          enemyManager.setLethalDamageGuard((currentEnemy: EnemyEntity) => (
            necromancy.handleLethalDamage(currentEnemy)
          ));
        }
      },
      detach: () => {
        runtime.coopDefenseEnemyAttackSystem?.setActionBlockedChecker(null);
        if (necromancy) {
          necromancy.setCorpseSink(null);
          enemyManager.setLethalDamageGuard(null);
        }
      },
    });
  }
}
