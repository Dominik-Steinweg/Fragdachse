import type { BaseManager } from '../entities/BaseManager';
import type { RoundOutcome } from '../network/NetworkBridge';

export class CoopDefenseRoundStateSystem {
  private concluded = false;

  constructor(
    private readonly baseManager: BaseManager,
    private readonly getSecondsLeft: () => number,
    private readonly bossRequired = false,
    private readonly isBossDefeated: () => boolean = () => true,
  ) {}

  update(): RoundOutcome | null {
    if (this.concluded) return null;

    const totalBaseHp = this.getTotalBaseHp();
    if (totalBaseHp <= 0) {
      this.concluded = true;
      return 'defeat';
    }

    if (this.getSecondsLeft() <= 0 && (!this.bossRequired || this.isBossDefeated())) {
      this.concluded = true;
      return 'victory';
    }

    return null;
  }

  applyDebugBaseDamage(amount: number): void {
    if (amount <= 0 || this.concluded) return;

    const targetBase = this.baseManager.getBases().find((base) => base.getHp() > 0);
    if (!targetBase) return;

    this.baseManager.applyDamage(targetBase.id, amount);
  }

  private getTotalBaseHp(): number {
    return this.baseManager.getBases().reduce((sum, base) => sum + base.getHp(), 0);
  }
}
