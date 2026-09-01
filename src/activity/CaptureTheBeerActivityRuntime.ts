import type { PlayerManager } from '../entities/PlayerManager';
import type { CaptureTheBeerFxEvent } from '../types';
import { CaptureTheBeerSystem } from '../systems/CaptureTheBeerSystem';
import type { ActivityRuntime } from '../world/ActivityRuntimeHost';

export interface CaptureTheBeerActivityRuntimeOptions {
  readonly playerManager: PlayerManager;
  readonly isPlayerInteractionAllowed: (playerId: string) => boolean;
  readonly onFx: (event: CaptureTheBeerFxEvent) => void;
}

/** Owns the Capture-the-Beer rules for exactly one Activity lifetime. */
export class CaptureTheBeerActivityRuntime implements ActivityRuntime {
  readonly system: CaptureTheBeerSystem;
  private destroyed = false;

  constructor(private readonly options: CaptureTheBeerActivityRuntimeOptions) {
    this.system = new CaptureTheBeerSystem(options.playerManager);
    this.system.setInteractionPredicate(options.isPlayerInteractionAllowed);
    this.system.setFxHandler(options.onFx);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.system.setInteractionPredicate(null);
    this.system.setFxHandler(null);
    this.system.reset();
    this.system.destroy();
  }
}
