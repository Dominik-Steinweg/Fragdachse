import type { PlayerManager }       from '../../entities/PlayerManager';
import type { ProjectileManager }   from '../../entities/ProjectileManager';
import type { CombatSystem }        from '../../systems/CombatSystem';
import type { EffectSystem }        from '../../effects/EffectSystem';
import type { SmokeSystem }         from '../../effects/SmokeSystem';
import type { FireSystem }          from '../../effects/FireSystem';
import type { StinkCloudSystem }    from '../../effects/StinkCloudSystem';
import type { HostPhysicsSystem }   from '../../systems/HostPhysicsSystem';
import type { InputSystem }         from '../../systems/InputSystem';
import type { LeftSidePanel }       from '../../ui/LeftSidePanel';
import type { RightSidePanel }      from '../../ui/RightSidePanel';
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
import type { EnergyShieldSystem }  from '../../systems/EnergyShieldSystem';
import type { ShieldBuffSystem }    from '../../systems/ShieldBuffSystem';
import type { TeslaDomeSystem }     from '../../systems/TeslaDomeSystem';
import type { TurretSystem }        from '../../systems/TurretSystem';
import type { TranslocatorSystem }  from '../../systems/TranslocatorSystem';
import type { TrainManager }        from '../../train/TrainManager';
import type { DecoySystem }         from '../../systems/DecoySystem';
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
  readonly smokeSystem:       SmokeSystem;
  readonly fireSystem:        FireSystem;
  readonly stinkCloudSystem:  StinkCloudSystem;
  readonly decoySystem:       DecoySystem;
  readonly hostPhysics:       HostPhysicsSystem;
  readonly inputSystem:       InputSystem;
  readonly leftPanel:         LeftSidePanel;
  readonly rightPanel:        RightSidePanel;
  readonly aimSystem:         AimSystem | null;
  readonly arenaCountdown:    ArenaCountdownOverlay | null;
  readonly playerStatusRing:  PlayerStatusRingLike | null;

  // ── Round-scoped (null outside a round; managed by ArenaLifecycleCoordinator) ──
  arenaResult:       ArenaBuilderResult | null;
  currentLayout:     ArenaLayout        | null;
  placementSystem:   PlacementSystem    | null;
  rockRegistry:      RockRegistry       | null;

  // Host-only round systems (null on clients and null outside a round)
  resourceSystem:    ResourceSystem    | null;
  burrowSystem:      BurrowSystem      | null;
  loadoutManager:    LoadoutManager    | null;
  powerUpSystem:     PowerUpSystem     | null;
  detonationSystem:  DetonationSystem  | null;
  armageddonSystem:  ArmageddonSystem  | null;
  shieldBuffSystem:  ShieldBuffSystem  | null;
  energyShieldSystem: EnergyShieldSystem | null;
  teslaDomeSystem:   TeslaDomeSystem   | null;
  turretSystem:      TurretSystem      | null;
  translocatorSystem: TranslocatorSystem | null;
  trainManager:      TrainManager      | null;
}
