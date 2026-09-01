import { EnergyInjectorSystem } from '../systems/EnergyInjectorSystem';
import { ReinforcementMatrixSystem } from '../systems/ReinforcementMatrixSystem';
import { TargetStatusSystem } from '../systems/TargetStatusSystem';
import type { WorldScopedBinding } from './WorldRuntime';

export interface WorldTargetingSystems {
  readonly reinforcementMatrix: ReinforcementMatrixSystem;
  readonly energyInjector: EnergyInjectorSystem;
  readonly targetStatus: TargetStatusSystem;
}

/** Owns the World-local target, matrix and energy-injector state shared by host and clients. */
export class WorldTargetingRuntime implements WorldScopedBinding {
  readonly systems: WorldTargetingSystems = {
    reinforcementMatrix: new ReinforcementMatrixSystem(),
    energyInjector: new EnergyInjectorSystem(),
    targetStatus: new TargetStatusSystem(),
  };
  private destroyed = false;

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.systems.reinforcementMatrix.clear();
    this.systems.energyInjector.clear();
    this.systems.targetStatus.clear();
  }
}
