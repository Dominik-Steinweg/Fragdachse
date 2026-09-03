import type { ProjectileManager } from '../entities/ProjectileManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { BurrowSystem } from '../systems/BurrowSystem';
import type { WorldMetrics } from './WorldMetrics';
import type { RockGridIndex } from '../arena/RockGridIndex';
import type { AirstrikeSystem } from '../systems/AirstrikeSystem';
import type { ArmageddonSystem } from '../systems/ArmageddonSystem';
import type { DetonationSystem } from '../systems/DetonationSystem';
import type { AirstrikeUltimateConfig } from '../loadout/LoadoutConfig';
import type { StinkCloudSystem } from '../effects/StinkCloudSystem';
import type { WorldScopedBinding } from './WorldRuntime';
import type { PlayerUltimateAirstrikeCapability } from './PlayerUltimateBehaviorRuntime';
import { AirstrikeSystem as ConcreteAirstrikeSystem } from '../systems/AirstrikeSystem';
import { ArmageddonSystem as ConcreteArmageddonSystem } from '../systems/ArmageddonSystem';
import { DetonationSystem as ConcreteDetonationSystem } from '../systems/DetonationSystem';

export interface WorldSupportGameplaySystems {
  readonly detonation: DetonationSystem;
  readonly armageddon: ArmageddonSystem;
  readonly airstrike: AirstrikeSystem;
}

export interface WorldSupportGameplayRuntimeOptions {
  readonly projectileManager: ProjectileManager;
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatSystem;
  readonly burrowSystem: BurrowSystem;
  readonly gameAudioSystem: GameAudioSystem;
  readonly worldMetrics: WorldMetrics;
  readonly rockGrid: RockGridIndex;
  readonly stinkCloudSystem: StinkCloudSystem;
  readonly reportDiagnosticEvent: (type: string, fields: Record<string, unknown>) => void;
  readonly broadcastExplosion: (x: number, y: number, radius: number, color: number, style: 'nuke') => void;
  readonly applyAirstrikeEnvironmentDamage: (
    x: number,
    y: number,
    radius: number,
    config: AirstrikeUltimateConfig,
    triggeredBy: string,
  ) => void;
  readonly onDestroy?: () => void;
}

/** Owns world-scoped detonation and support-ultimate capabilities. */
export class WorldSupportGameplayRuntime implements WorldScopedBinding, PlayerUltimateAirstrikeCapability {
  readonly systems: WorldSupportGameplaySystems;
  private destroyed = false;

  constructor(private readonly options: WorldSupportGameplayRuntimeOptions) {
    const detonation = new ConcreteDetonationSystem(options.projectileManager);
    const armageddon = new ConcreteArmageddonSystem(options.worldMetrics);
    armageddon.setRockGrid(options.rockGrid);
    const airstrike = new ConcreteAirstrikeSystem();
    airstrike.setExplodedCallback((x, y, radius, triggeredBy, config) => {
      options.reportDiagnosticEvent('airstrike:explode', { radius, triggeredBy, delayMs: config.delayMs });
      options.broadcastExplosion(x, y, radius, 0xff9933, 'nuke');
      options.applyAirstrikeEnvironmentDamage(x, y, radius, config, triggeredBy);
    });
    this.systems = { detonation, armageddon, airstrike };
    options.combatSystem.setDetonationSystem(detonation);
    options.combatSystem.setStinkCloudSystem(options.stinkCloudSystem);
    options.burrowSystem.setStinkCloudSystem(options.stinkCloudSystem);
  }

  scheduleStrike(
    playerId: string,
    targetX: number,
    targetY: number,
    config: AirstrikeUltimateConfig,
    armedAt: number,
  ): boolean {
    if (this.destroyed
      || !Number.isFinite(targetX)
      || !Number.isFinite(targetY)
      || !Number.isFinite(armedAt)) return false;
    const player = this.options.playerManager.getPlayer(playerId);
    if (!player || !this.options.combatSystem.isAlive(playerId)) return false;
    this.options.gameAudioSystem.playSound('sfx_airstrike_countdown', targetX, targetY);
    return this.systems.airstrike.scheduleStrike(playerId, targetX, targetY, config, armedAt);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.options.combatSystem.setDetonationSystem(null);
    this.options.combatSystem.setStinkCloudSystem(null);
    this.options.burrowSystem.setStinkCloudSystem(null);
    this.systems.detonation.reset();
    this.systems.armageddon.destroyAll();
    this.systems.airstrike.clear();
    this.systems.airstrike.setExplodedCallback(() => { /* noop */ });
    this.systems.airstrike.setResolvedCallback(null);
    this.options.onDestroy?.();
  }
}
