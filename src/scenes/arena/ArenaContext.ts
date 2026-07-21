import type { PlayerManager }       from '../../entities/PlayerManager';
import type { ProjectileManager }   from '../../entities/ProjectileManager';
import type { CombatSystem }        from '../../systems/CombatSystem';
import type { EffectSystem }        from '../../effects/EffectSystem';
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
import type { PlacementSystem }     from '../../systems/PlacementSystem';
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
import type { CoopDefensePlayerModifierSystem } from '../../systems/CoopDefensePlayerModifierSystem';
import type { GuardianSpiritSystem } from '../../systems/GuardianSpiritSystem';
import type { SlimeTrailSystem } from '../../systems/SlimeTrailSystem';
import type { FlamethrowerUpgradeSystem } from '../../systems/FlamethrowerUpgradeSystem';
import type { WeaponUpgradeSystem } from '../../systems/WeaponUpgradeSystem';
import type { NecromancySystem } from '../../systems/NecromancySystem';
import type { CoopDefenseRoundStateSystem } from '../../systems/CoopDefenseRoundStateSystem';
import type { CoopDefenseWaveSpawner } from '../../systems/CoopDefenseWaveSpawner';
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
  rockRegistry:      RockRegistry       | null;
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
  guardianSpiritSystem: GuardianSpiritSystem | null;
  slimeTrailSystem: SlimeTrailSystem | null;
  flamethrowerUpgradeSystem: FlamethrowerUpgradeSystem | null;
  weaponUpgradeSystem: WeaponUpgradeSystem | null;
  necromancySystem: NecromancySystem | null;
  coopDefenseEnemyAttackSystem: CoopDefenseEnemyAttackSystem | null;
  coopDefenseEnemyAbilitySystem: CoopDefenseEnemyAbilitySystem | null;
  coopDefenseEnemyTrainAwarenessSystem: CoopDefenseEnemyTrainAwarenessSystem | null;
  coopDefenseEnemyBurrowSystem: CoopDefenseEnemyBurrowSystem | null;
  coopDefenseRoundStateSystem: CoopDefenseRoundStateSystem | null;
  coopDefenseWaveSpawner: CoopDefenseWaveSpawner | null;
  coopDefenseAirstrikeDirector: CoopDefenseAirstrikeDirector | null;
  translocatorSystem: TranslocatorSystem | null;
  tunnelSystem:      TunnelSystem      | null;
  trainManager:      TrainManager      | null;
  enemyFlowFieldService: EnemyFlowFieldService | null;
  enemyPlayerFlowFieldService: EnemyFlowFieldService | null;
  enemyBossFlowFieldService: EnemyFlowFieldService | null;
  allyFlowFieldServices: Map<string, EnemyFlowFieldService>;
}
