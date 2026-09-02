import type { EnemyEntity } from '../../entities/EnemyEntity';
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
  readonly getReinforcementMatrices: () => Parameters<CombatRenderers['reinforcementMatrix']['syncVisuals']>[0];
  readonly getEnergyInjectorEffects: () => Parameters<CombatRenderers['energyInjector']['syncVisuals']>[0];
  readonly getRemoteControlTargets: () => Parameters<CombatRenderers['remoteControl']['syncVisuals']>[0];
  readonly getAuraEnemies: () => readonly EnemyEntity[];
  readonly syncEnemyHostVisuals: () => void;
  readonly getEnemyCount: () => number;
  readonly getStrategicTargets: (now: number) => Parameters<CombatRenderers['ak47StrategicTargets']['sync']>[0];
  readonly getStrategicTargetEnemyManager: () => Parameters<CombatRenderers['ak47StrategicTargets']['sync']>[1];
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
    const auraEnemies = frame.inArena ? this.sources.getAuraEnemies() : [];
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
    this.renderers.ak47StrategicTargets.sync(
      active ? this.sources.getStrategicTargets(now) : [],
      this.sources.getStrategicTargetEnemyManager(),
      this.sources.getLocalPlayerId(),
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
