import type { EnemyVisualSource } from '../../entities/EnemyVisualSource';
import type {
  SyncedAk47StrategicTarget,
  SyncedEnergyInjectorEffect,
  SyncedReinforcementMatrix,
  SyncedRemoteControlTurret,
} from '../../types';
import type { RendererBundle } from './RendererBundle';
import type { ArenaDiagnosticsFrame } from './ArenaDiagnosticsController';

type CombatRenderers = Pick<RendererBundle,
  | 'beer'
  | 'timeBubble'
  | 'blackHole'
  | 'bfg'
  | 'plasmaBurner'
  | 'reinforcementMatrix'
  | 'energyInjector'
  | 'remoteControl'
  | 'teslaDome'
  | 'teslaNova'
  | 'healingAura'
  | 'miniTeslaDome'
  | 'energyShield'
  | 'guardianSpirit'
  | 'repairDrone'
  | 'slimeTrail'
  | 'flamethrowerUpgrades'
  | 'ak47StrategicTargets'
>;

export interface ArenaCombatPresentationSourcePort {
  readonly getSynchronizedNow: () => number;
  readonly updateVisualFeedback: (delta: number) => void;
  readonly getReinforcementMatrices: () => readonly SyncedReinforcementMatrix[];
  readonly getEnergyInjectorEffects: () => readonly SyncedEnergyInjectorEffect[];
  readonly getRemoteControlTargets: () => readonly SyncedRemoteControlTurret[];
  readonly getEnemyVisuals: () => readonly EnemyVisualSource[];
  readonly syncEnemyHostVisuals: () => void;
  readonly getEnemyCount: () => number;
  readonly getStrategicTargets: (now: number) => readonly SyncedAk47StrategicTarget[];
  readonly getStrategicTargetEnemy: (enemyId: string) => EnemyVisualSource | null;
  readonly getLocalPlayerId: () => string;
}

export interface ArenaCombatPresentationFrame {
  readonly inArena: boolean;
  readonly delta: number;
}

/**
 * Scene-lifetime owner for general combat and effect presentation.
 * World/Activity bindings remain the owners of their replicated state; this controller only
 * sequences the existing renderers and consumes narrow read-only source ports.
 */
export class ArenaCombatPresentationController {
  private destroyed = false;

  constructor(
    private readonly renderers: CombatRenderers,
    private readonly sources: ArenaCombatPresentationSourcePort,
  ) {}

  sync(frame: ArenaCombatPresentationFrame, diagnosticsFrame: ArenaDiagnosticsFrame | null): void {
    if (this.destroyed) return;
    const now = this.sources.getSynchronizedNow();
    this.renderers.beer.update(now, frame.delta);
    this.renderers.timeBubble.update(frame.delta);
    this.renderers.blackHole.update(frame.delta);
    this.renderers.bfg.update();
    this.renderers.plasmaBurner.update(frame.delta);
    this.sources.updateVisualFeedback(frame.delta);
    this.renderers.reinforcementMatrix.syncVisuals(frame.inArena ? this.sources.getReinforcementMatrices() : [], now);
    this.renderers.energyInjector.syncVisuals(frame.inArena ? this.sources.getEnergyInjectorEffects() : [], now);
    this.renderers.remoteControl.syncVisuals(frame.inArena ? this.sources.getRemoteControlTargets() : [], now);
    this.renderers.teslaDome.update(frame.delta);
    this.renderers.teslaNova.update();
    diagnosticsFrame?.begin('visualEnemy');
    const auraEnemies = frame.inArena ? this.sources.getEnemyVisuals() : [];
    this.sources.syncEnemyHostVisuals();
    diagnosticsFrame?.end('visualEnemy');
    this.renderers.healingAura.syncEnemies(auraEnemies);
    this.renderers.healingAura.update(frame.delta);
    this.renderers.miniTeslaDome.syncEnemies(auraEnemies);
    this.renderers.miniTeslaDome.update(frame.delta);
    this.renderers.energyShield.update(frame.delta);
    this.renderers.guardianSpirit.update(frame.delta);
    this.renderers.repairDrone.update(frame.delta);
    this.renderers.slimeTrail.update(frame.delta);
    this.renderers.flamethrowerUpgrades.update(now);
    diagnosticsFrame?.mark('visualEffectsEnd');
  }

  /** Synchronisiert das AK-Ziel an seiner etablierten Position vor Kamera-Feedback. */
  syncStrategicTargets(active: boolean): void {
    if (this.destroyed) return;
    const now = this.sources.getSynchronizedNow();
    const localPlayerId = this.sources.getLocalPlayerId();
    const targets = active ? this.sources.getStrategicTargets(now) : [];
    const target = targets.find(entry => entry.ownerId === localPlayerId);
    this.renderers.ak47StrategicTargets.sync(
      targets,
      target ? this.sources.getStrategicTargetEnemy(target.enemyId) : null,
      localPlayerId,
      now,
      active,
    );
  }

  getEnemyCount(): number {
    return this.sources.getEnemyCount();
  }

  destroy(): void {
    this.destroyed = true;
  }
}
