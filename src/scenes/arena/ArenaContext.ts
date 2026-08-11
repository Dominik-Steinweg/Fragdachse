import type { PlayerManager }       from '../../entities/PlayerManager';
import type { ProjectileManager }   from '../../entities/ProjectileManager';
import type { CombatSystem }        from '../../systems/CombatSystem';
import type { EffectSystem }        from '../../effects/EffectSystem';
import type { VisualFeedbackDirector } from '../../effects/VisualFeedbackDirector';
import type { GameAudioSystem }     from '../../audio/GameAudioSystem';
import type { SmokeSystem }         from '../../effects/SmokeSystem';
import type { FireSystem }          from '../../effects/FireSystem';
import type { StinkCloudSystem }    from '../../effects/StinkCloudSystem';
import type { HostPhysicsSystem }   from '../../systems/HostPhysicsSystem';
import type { InputSystem }         from '../../systems/InputSystem';
import type { LeftSidePanel }       from '../../ui/LeftSidePanel';
import type { RightSidePanel }      from '../../ui/RightSidePanel';
import type { CenterHUD }           from '../../ui/CenterHUD';
import type { AimSystem }           from '../../ui/AimSystem';
import type { ArenaCountdownOverlay } from '../../ui/ArenaCountdownOverlay';
import type { LocalArenaHudData }   from '../../ui/LocalArenaHudData';
import type { ArenaBuilderResult }  from '../../arena/ArenaBuilder';
import type { RockRegistry }        from '../../arena/RockRegistry';
import type { LightOccluderIndex }  from '../../effects/LightOccluderIndex';
import type { PlacementSystem }     from '../../systems/PlacementSystem';
import type { ReinforcementMatrixSystem } from '../../systems/ReinforcementMatrixSystem';
import type { EnergyInjectorSystem } from '../../systems/EnergyInjectorSystem';
import type { TargetStatusSystem } from '../../systems/TargetStatusSystem';
import type { ResourceSystem }      from '../../systems/ResourceSystem';
import type { BurrowSystem }        from '../../systems/BurrowSystem';
import type { LoadoutManager }      from '../../loadout/LoadoutManager';
import type { PowerUpSystem }       from '../../powerups/PowerUpSystem';
import type { DetonationSystem }    from '../../systems/DetonationSystem';
import type { ArmageddonSystem }    from '../../systems/ArmageddonSystem';
import type { AirstrikeSystem }     from '../../systems/AirstrikeSystem';
import type { EnergyShieldSystem }  from '../../systems/EnergyShieldSystem';
import type { ShieldBuffSystem }    from '../../systems/ShieldBuffSystem';
import type { TeslaDomeSystem }     from '../../systems/TeslaDomeSystem';
import type { TurretSystem }        from '../../systems/TurretSystem';
import type { CoopDefenseEnemyAttackSystem } from '../../systems/CoopDefenseEnemyAttackSystem';
import type { CoopDefenseEnemyAbilitySystem } from '../../systems/CoopDefenseEnemyAbilitySystem';
import type { CoopDefenseEnemyTrainAwarenessSystem } from '../../systems/CoopDefenseEnemyTrainAwarenessSystem';
import type { CoopDefenseEnemyBurrowSystem } from '../../systems/CoopDefenseEnemyBurrowSystem';
import type { CoopDefenseEnemyDodgeSystem } from '../../systems/CoopDefenseEnemyDodgeSystem';
import type { CoopDefenseEnemyCombatPositioningSystem } from '../../systems/CoopDefenseEnemyCombatPositioningSystem';
import type { CoopDefenseVoidHunterSystem } from '../../systems/CoopDefenseVoidHunterSystem';
import type { CoopDefenseTimebombSystem } from '../../systems/CoopDefenseTimebombSystem';
import type { CoopDefenseSurvivalSystem } from '../../systems/CoopDefenseSurvivalSystem';
import type { EnemyStrategicTargetService } from '../../systems/EnemyStrategicTargetService';
import type { CoopDefensePlayerModifierSystem } from '../../systems/CoopDefensePlayerModifierSystem';
import type { GuardianSpiritSystem } from '../../systems/GuardianSpiritSystem';
import type { RepairDroneSystem } from '../../systems/RepairDroneSystem';
import type { SlimeTrailSystem } from '../../systems/SlimeTrailSystem';
import type { FlamethrowerUpgradeSystem } from '../../systems/FlamethrowerUpgradeSystem';
import type { CoopDefenseItemRuntimeSystem } from '../../systems/CoopDefenseItemRuntimeSystem';
import type { WeaponUpgradeSystem } from '../../systems/WeaponUpgradeSystem';
import type { NecromancySystem } from '../../systems/NecromancySystem';
import type { CoopDefenseRoundStateSystem } from '../../systems/CoopDefenseRoundStateSystem';
import type { CoopDefenseSpawnExecutor } from '../../systems/CoopDefenseSpawnExecutor';
import type { CoopDefensePersistentPressureSystem } from '../../systems/CoopDefensePersistentPressureSystem';
import type { CoopDefenseBossSystem } from '../../systems/CoopDefenseBossSystem';
import type { CoopDefenseMapDirector } from '../../systems/CoopDefenseMapDirector';
import type { CoopDefenseObjectiveRepairSystem } from '../../systems/CoopDefenseObjectiveRepairSystem';
import type { CoopDefenseObjectivePlacementRewardSystem } from '../../systems/CoopDefenseObjectivePlacementRewardSystem';
import type { CoopDefenseSecondaryObjectiveSystem } from '../../systems/CoopDefenseSecondaryObjectiveSystem';
import type { CoopDefenseCarrySystem } from '../../systems/CoopDefenseCarrySystem';
import type { CoopDefenseTeamBuffSystem } from '../../systems/CoopDefenseTeamBuffSystem';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../../config/coopDefenseMaps';
import type { CoopDefenseAirstrikeDirector } from '../../systems/CoopDefenseAirstrikeDirector';
import type { TranslocatorSystem }  from '../../systems/TranslocatorSystem';
import type { CaptureTheBeerSystem } from '../../systems/CaptureTheBeerSystem';
import type { BaseManager }          from '../../entities/BaseManager';
import type { EnemyManager }         from '../../entities/EnemyManager';
import type { TunnelSystem } from '../../systems/TunnelSystem';
import type { TrainManager }        from '../../train/TrainManager';
import type { DecoySystem }         from '../../systems/DecoySystem';
import type { TimeBubbleSystem }    from '../../systems/TimeBubbleSystem';
import type { EnemyFlowFieldService } from '../../systems/EnemyFlowFieldService';
import type { ArenaLayout }         from '../../types';

interface PlayerStatusRingLike {
  setActive(active: boolean): void;
  update(data: LocalArenaHudData): void;
}

/**
 * Shared dependency container passed to all arena coordinators.
 *
 * Scene-lifetime systems are readonly – they exist from create() until the scene
 * is destroyed and never change identity.
 *
 * Round-scoped systems are writable and null outside an active round. They are
 * populated by ArenaLifecycleCoordinator.buildArena() and cleared by tearDownArena().
 * Coordinators must always null-check these before use.
 */
export interface ArenaContext {
  // ── Scene-lifetime (always present after create()) ────────────────────────
  readonly playerManager:     PlayerManager;
  readonly projectileManager: ProjectileManager;
  readonly combatSystem:      CombatSystem;
  readonly effectSystem:      EffectSystem;
  /** Zentrale Regie für Kamerabewegung und Trefferreaktion. Nie `camera.shake()` direkt rufen. */
  readonly visualFeedback:    VisualFeedbackDirector;
  readonly gameAudioSystem:   GameAudioSystem;
  readonly smokeSystem:       SmokeSystem;
  readonly fireSystem:        FireSystem;
  readonly stinkCloudSystem:  StinkCloudSystem;
  readonly decoySystem:       DecoySystem;
  readonly hostPhysics:       HostPhysicsSystem;
  readonly inputSystem:       InputSystem;
  readonly leftPanel:         LeftSidePanel;
  readonly rightPanel:        RightSidePanel;
  readonly centerHUD:         CenterHUD;
  readonly aimSystem:         AimSystem | null;
  readonly arenaCountdown:    ArenaCountdownOverlay | null;
  readonly playerStatusRing:  PlayerStatusRingLike | null;

  // ── Round-scoped (null outside a round; managed by ArenaLifecycleCoordinator) ──
  arenaResult:       ArenaBuilderResult | null;
  currentLayout:     ArenaLayout        | null;
  placementSystem:   PlacementSystem    | null;
  reinforcementMatrixSystem: ReinforcementMatrixSystem | null;
  energyInjectorSystem: EnergyInjectorSystem | null;
  targetStatusSystem: TargetStatusSystem | null;
  rockRegistry:      RockRegistry       | null;
  /**
   * Cache der lichtblockierenden Hindernisse. Wird aus denselben Referenzen aufgebaut,
   * die `CombatSystem` für Line-of-Sight nutzt, und über
   * `RockVisualHelper.refreshObstacleVisuals()` invalidiert – demselben Trichter, der
   * auch die statischen Sonnenschatten neu zeichnet.
   */
  lightOccluderIndex: LightOccluderIndex | null;
  captureTheBeerSystem: CaptureTheBeerSystem | null;
  baseManager: BaseManager | null;
  enemyManager: EnemyManager | null;

  // Host-only round systems (null on clients and null outside a round)
  resourceSystem:    ResourceSystem    | null;
  burrowSystem:      BurrowSystem      | null;
  loadoutManager:    LoadoutManager    | null;
  powerUpSystem:     PowerUpSystem     | null;
  detonationSystem:  DetonationSystem  | null;
  armageddonSystem:  ArmageddonSystem  | null;
  airstrikeSystem:   AirstrikeSystem   | null;
  shieldBuffSystem:  ShieldBuffSystem  | null;
  energyShieldSystem: EnergyShieldSystem | null;
  timeBubbleSystem:  TimeBubbleSystem  | null;
  teslaDomeSystem:   TeslaDomeSystem   | null;
  turretSystem:      TurretSystem      | null;
  coopDefensePlayerModifierSystem: CoopDefensePlayerModifierSystem | null;
  coopDefenseItemRuntimeSystem: CoopDefenseItemRuntimeSystem | null;
  guardianSpiritSystem: GuardianSpiritSystem | null;
  repairDroneSystem: RepairDroneSystem | null;
  slimeTrailSystem: SlimeTrailSystem | null;
  flamethrowerUpgradeSystem: FlamethrowerUpgradeSystem | null;
  weaponUpgradeSystem: WeaponUpgradeSystem | null;
  necromancySystem: NecromancySystem | null;
  coopDefenseEnemyAttackSystem: CoopDefenseEnemyAttackSystem | null;
  coopDefenseEnemyAbilitySystem: CoopDefenseEnemyAbilitySystem | null;
  coopDefenseEnemyTrainAwarenessSystem: CoopDefenseEnemyTrainAwarenessSystem | null;
  coopDefenseEnemyBurrowSystem: CoopDefenseEnemyBurrowSystem | null;
  coopDefenseEnemyDodgeSystem: CoopDefenseEnemyDodgeSystem | null;
  coopDefenseEnemyCombatPositioningSystem: CoopDefenseEnemyCombatPositioningSystem | null;
  coopDefenseVoidHunterSystem: CoopDefenseVoidHunterSystem | null;
  coopDefenseTimebombSystem: CoopDefenseTimebombSystem | null;
  coopDefenseSurvivalSystem: CoopDefenseSurvivalSystem | null;
  coopDefenseRoundStateSystem: CoopDefenseRoundStateSystem | null;
  coopDefenseSpawnExecutor: CoopDefenseSpawnExecutor | null;
  coopDefensePersistentPressureSystem: CoopDefensePersistentPressureSystem | null;
  coopDefenseBossSystem: CoopDefenseBossSystem | null;
  coopDefenseMapDirector: CoopDefenseMapDirector | null;
  coopDefenseSecondaryObjectiveSystem: CoopDefenseSecondaryObjectiveSystem | null;
  coopDefenseCarrySystem: CoopDefenseCarrySystem | null;
  /** Host-only: one shared, round-local team buff end timestamp. */
  coopDefenseTeamBuffSystem: CoopDefenseTeamBuffSystem | null;
  /**
   * Authored Nebenmissionen der laufenden Runde. Host und Client lösen sie gleichermaßen aus
   * der Map-Konfiguration auf; HUD und Weltmarkierung lesen daraus Name, Reward-Hinweis und
   * Zielreferenzen, statt sie über das Netzwerk zu beziehen.
   */
  coopDefenseSecondaryObjectiveConfigs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[];
  /** Host-only: Wiederherstellung eines gehaltenen Missionsziels. */
  coopDefenseObjectiveRepairSystem: CoopDefenseObjectiveRepairSystem | null;
  /** Host-only: one-shot placement rewards from completed Hold objectives. */
  coopDefenseObjectivePlacementRewardSystem: CoopDefenseObjectivePlacementRewardSystem | null;
  coopDefenseAirstrikeDirector: CoopDefenseAirstrikeDirector | null;
  translocatorSystem: TranslocatorSystem | null;
  tunnelSystem:      TunnelSystem      | null;
  trainManager:      TrainManager      | null;
  enemyFlowFieldService: EnemyFlowFieldService | null;
  enemyPlayerFlowFieldService: EnemyFlowFieldService | null;
  enemyStrategicFlowFieldService: EnemyFlowFieldService | null;
  enemyStrategicTargetService: EnemyStrategicTargetService | null;
  enemyBossFlowFieldService: EnemyFlowFieldService | null;
  allyFlowFieldServices: Map<string, EnemyFlowFieldService>;
}
