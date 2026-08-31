import { EnergyInjectorSystem } from '../systems/EnergyInjectorSystem';
import { ReinforcementMatrixSystem } from '../systems/ReinforcementMatrixSystem';
import { TargetStatusSystem } from '../systems/TargetStatusSystem';
import type { WorldScopedBinding } from './WorldRuntime';

export interface WorldTargetingSystems {
  readonly reinforcementMatrix: ReinforcementMatrixSystem;
  readonly energyInjector: EnergyInjectorSystem;
  readonly targetStatus: TargetStatusSystem;
}

export interface WorldTargetingRuntimeOptions {
  readonly onSystemsChanged: (systems: WorldTargetingSystems | null) => void;
}

/** Owns the World-local target, matrix and energy-injector state shared by host and clients. */
export class WorldTargetingRuntime implements WorldScopedBinding {
  readonly systems: WorldTargetingSystems = {
    reinforcementMatrix: new ReinforcementMatrixSystem(),
    energyInjector: new EnergyInjectorSystem(),
    targetStatus: new TargetStatusSystem(),
  };
  private destroyed = false;

  constructor(private readonly options: WorldTargetingRuntimeOptions) {
    options.onSystemsChanged(this.systems);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.systems.reinforcementMatrix.clear();
    this.systems.energyInjector.clear();
    this.systems.targetStatus.clear();
    this.options.onSystemsChanged(null);
  }
}
