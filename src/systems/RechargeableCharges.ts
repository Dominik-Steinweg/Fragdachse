export interface RechargeableChargeConfig {
  readonly maxCharges: number;
  readonly rechargeIntervalMs: number;
  readonly startCharges?: number;
  readonly rechargeMode: 'preserve-progress' | 'restart-on-consume';
}

export interface RechargeableChargeSnapshot {
  readonly availableCharges: number;
  readonly maxCharges: number;
  readonly rechargeIntervalMs: number;
  readonly nextChargeAt: number | null;
}

/** One discrete stock, advanced solely by its owner's simulation clock. Cadence stays with the caller. */
export class RechargeableCharges {
  private config: RechargeableChargeConfig;
  private available = 0;
  private nextAt: number | null = null;

  constructor(config: RechargeableChargeConfig, now: number) {
    this.config = validateConfig(config);
    this.reset(now);
  }

  getAvailableCharges(now: number): number {
    this.advance(now);
    return this.available;
  }

  canConsume(now: number): boolean { return this.getAvailableCharges(now) > 0; }

  consume(now: number): boolean {
    if (!this.canConsume(now)) return false;
    this.available -= 1;
    if (this.nextAt === null || this.config.rechargeMode === 'restart-on-consume') {
      this.nextAt = now + this.config.rechargeIntervalMs;
    }
    this.advance(now);
    return true;
  }

  getSnapshot(now: number): RechargeableChargeSnapshot {
    this.advance(now);
    return {
      availableCharges: this.available, maxCharges: this.config.maxCharges,
      rechargeIntervalMs: this.config.rechargeIntervalMs, nextChargeAt: this.nextAt,
    };
  }

  reset(now: number): void {
    validateTime(now);
    this.available = this.config.startCharges ?? this.config.maxCharges;
    this.nextAt = this.available < this.config.maxCharges ? now + this.config.rechargeIntervalMs : null;
    this.advance(now);
  }

  reconfigure(config: RechargeableChargeConfig, now: number): void {
    const next = validateConfig(config);
    this.advance(now);
    const remainingFraction = this.nextAt === null || this.config.rechargeIntervalMs === 0
      ? 1 : Math.max(0, Math.min(1, (this.nextAt - now) / this.config.rechargeIntervalMs));
    this.config = next;
    this.available = Math.min(this.available, next.maxCharges);
    this.nextAt = this.available < next.maxCharges ? now + remainingFraction * next.rechargeIntervalMs : null;
    this.advance(now);
  }

  private advance(now: number): void {
    validateTime(now);
    if (this.nextAt === null || now < this.nextAt) return;
    const interval = this.config.rechargeIntervalMs;
    const restored = interval === 0 ? this.config.maxCharges : 1 + Math.floor((now - this.nextAt) / interval);
    this.available = Math.min(this.config.maxCharges, this.available + restored);
    this.nextAt = this.available === this.config.maxCharges ? null : this.nextAt + restored * interval;
  }
}

function validateTime(now: number): void {
  if (!Number.isFinite(now)) throw new Error('Charge time must be finite');
}

function validateConfig(config: RechargeableChargeConfig): RechargeableChargeConfig {
  const start = config.startCharges ?? config.maxCharges;
  if (!Number.isSafeInteger(config.maxCharges) || config.maxCharges < 1
    || !Number.isSafeInteger(start) || start < 0 || start > config.maxCharges
    || !Number.isFinite(config.rechargeIntervalMs) || config.rechargeIntervalMs < 0
    || !['preserve-progress', 'restart-on-consume'].includes(config.rechargeMode)) {
    throw new Error('Invalid rechargeable charge configuration');
  }
  return { ...config };
}
