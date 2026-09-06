export type HealthBarVisibility = 'after-damage' | 'alive' | 'damaged';

export interface HealthBarFeedbackTuning {
  readonly damageHoldMs: number;
  readonly damageHalfLifeMs: number;
  readonly newEpisodeQuietMs: number;
  readonly visibleAfterDamageMs: number;
  readonly settleDistancePx: number;
  readonly healEmphasisMs: number;
  readonly healEmphasisStrength: number;
}

/** Local presentation state only. Absolute times make observations and frame ticks composable. */
export class HealthBarFeedbackModel {
  hp = 0;
  maxHp = 1;
  trailHp = 0;
  visibleUntil = -Infinity;
  healUntil = -Infinity;
  private lastTime = 0;
  private holdUntil = -Infinity;
  private lastDamage = -Infinity;
  private suppressed = false;

  constructor(
    readonly visibility: HealthBarVisibility,
    readonly tuning: HealthBarFeedbackTuning,
  ) {}

  baseline(hp: number, maxHp: number, now: number): void {
    this.maxHp = Math.max(1, maxHp);
    this.hp = Math.max(0, Math.min(this.maxHp, hp));
    this.trailHp = this.hp;
    this.lastTime = now;
    this.clearEpisode();
  }

  observe(hp: number, maxHp: number, now: number, visibleWidthPx: number): void {
    this.advance(now, visibleWidthPx);
    maxHp = Math.max(1, maxHp);
    hp = Math.max(0, Math.min(maxHp, hp));
    if (hp === this.hp && maxHp === this.maxHp) return;
    if (this.suppressed) {
      this.baseline(hp, maxHp, now);
      return;
    }
    if (maxHp !== this.maxHp) {
      const deadline = this.visibleUntil;
      const lastDamage = this.lastDamage;
      this.baseline(hp, maxHp, now);
      this.visibleUntil = deadline;
      // A max-HP rebase is not a quiet gap in an ongoing stream of damage.
      this.lastDamage = lastDamage;
      return;
    }
    if (hp < this.hp) {
      if (this.trailHp === this.hp && now - this.lastDamage >= this.tuning.newEpisodeQuietMs) {
        this.holdUntil = now + this.tuning.damageHoldMs;
      }
      this.lastDamage = now;
      this.visibleUntil = now + this.tuning.visibleAfterDamageMs;
      this.healUntil = -Infinity;
    } else {
      // Emphasize only an already visible fill; regeneration never summons a temporary bar.
      this.healUntil = this.isVisible(now) ? now + this.tuning.healEmphasisMs : -Infinity;
      this.trailHp = hp;
      this.holdUntil = -Infinity;
    }
    this.hp = hp;
    if (hp >= maxHp && this.visibility === 'after-damage') this.visibleUntil = -Infinity;
  }

  setSuppressed(suppressed: boolean, now: number): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.baseline(this.hp, this.maxHp, now);
  }

  advance(now: number, visibleWidthPx: number): void {
    now = Math.max(this.lastTime, now);
    const activeDelta = Math.max(0, now - Math.max(this.lastTime, this.holdUntil));
    if (this.trailHp > this.hp) {
      this.trailHp = this.hp + (this.trailHp - this.hp)
        * Math.exp(-Math.LN2 * activeDelta / Math.max(1, this.tuning.damageHalfLifeMs));
      if ((this.trailHp - this.hp) / this.maxHp * Math.max(1, visibleWidthPx) <= this.tuning.settleDistancePx) {
        this.trailHp = this.hp;
      }
    }
    this.lastTime = now;
  }

  isVisible(now: number): boolean {
    if (this.suppressed || this.hp <= 0) return false;
    if (this.visibility === 'alive') return true;
    return this.hp < this.maxHp && (this.visibility === 'damaged' || now < this.visibleUntil);
  }

  healEmphasis(now: number): number {
    return Math.max(0, Math.min(1, (this.healUntil - now) / Math.max(1, this.tuning.healEmphasisMs)))
      * this.tuning.healEmphasisStrength;
  }

  private clearEpisode(): void {
    this.visibleUntil = this.healUntil = this.holdUntil = this.lastDamage = -Infinity;
  }
}
