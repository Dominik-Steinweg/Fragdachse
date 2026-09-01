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
import type { HostHeldActionSystem } from '../../systems/HostHeldActionSystem';
import type { DecoySystem }         from '../../systems/DecoySystem';

interface PlayerStatusRingLike {
  setActive(active: boolean): void;
  update(data: LocalArenaHudData): void;
}

/**
 * Scene-lifetime infrastructure shared by arena coordinators.
 *
 * Scene-lifetime systems are readonly – they exist from create() until the scene
 * is destroyed and never change identity.
 *
 * World- und Activity-Runtime gehoeren ihren konkreten Ownern und sind absichtlich nicht Teil
 * dieses Contexts. Consumer erhalten direkte Owner-Referenzen oder kleine fachliche Ports.
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

  // ── Transitional RPC state ────────────────────────────────────────────────
  // Nicht Teil des 11A-Runtime-Cutovers: RpcCoordinator wird erst in 11B auf seinen kleinen
  // fachlichen Port umgestellt. Dieses Feld spiegelt keinen bereits migrierten Runtime-Owner.
  hostHeldActionSystem: HostHeldActionSystem | null;
}
