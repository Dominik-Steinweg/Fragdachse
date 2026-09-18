import { SHOOTING_RANGE } from './ShootingRangeLayout';
import { shootingRangeAction, type ShootingRangeRequest, type ShootingRangeState, type ShootingRangeTarget } from './ShootingRangeContracts';

export interface ShootingRangePorts {
  readonly spawn: (slot: number) => ShootingRangeTarget;
  readonly remove: (target: ShootingRangeTarget) => void;
  readonly alive: (target: ShootingRangeTarget) => boolean;
}

/** Host writer. Combat supplies committed HP loss; presentation never owns measurement state. */
export class ShootingRangeRuntime {
  private session = 0;
  private enabled = false;
  private supply = false;
  private count = 1;
  private targets: (ShootingRangeTarget | null)[] = [];
  private damage: { at: number; amount: number }[] = [];
  private samples: { at: number; dps: number }[] = [];
  private dps = 0;
  private scale = 100;
  private nextSample = 0;
  private destroyed = false;
  constructor(private readonly ports: ShootingRangePorts) {}

  snapshot(): ShootingRangeState {
    return { session: this.session, enabled: this.enabled, count: this.count, supply: this.supply,
      targets: this.targets.map(target => target ? { ...target } : null), dps: this.dps,
      scale: this.scale, samples: this.samples.map(sample => ({ ...sample })) };
  }
  isTrainingTarget(id: string, generation?: number): boolean {
    return this.targets.some(target => target?.id === id && (generation === undefined || target.generation === generation));
  }
  suppliesPlayers(): boolean { return this.enabled && this.supply && !this.destroyed; }

  request(request: ShootingRangeRequest, now: number): boolean {
    if (this.destroyed || !Number.isFinite(now) || request.session !== this.session
      || shootingRangeAction(this.snapshot(), request.control) !== request.action) return false;
    if (request.action === 'enable') {
      this.session++;
      this.enabled = true;
      this.count = 1;
      this.supply = false;
      this.clearMeasurement();
      this.nextSample = now;
      this.targets = [this.ports.spawn(0)];
    } else if (request.action === 'disable') {
      this.enabled = false;
      this.supply = false;
      const targets = this.targets;
      this.targets = [];
      for (const target of targets) if (target) this.ports.remove(target);
      this.count = 1;
      this.clearMeasurement();
    } else if (request.action === 'add') {
      this.targets.push(this.ports.spawn(this.count++));
    } else if (request.action === 'remove') {
      this.count--;
      const target = this.targets.pop();
      if (target) this.ports.remove(target);
    } else this.supply = request.action === 'supply-on';
    return true;
  }

  recordDamage(target: ShootingRangeTarget, amount: number, now: number): void {
    if (!this.enabled || this.destroyed || !this.isTrainingTarget(target.id, target.generation)
      || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(now)) return;
    const last = this.damage[this.damage.length - 1];
    if (last?.at === now) last.amount += amount;
    else this.damage.push({ at: now, amount });
  }

  /** Called once after all combat reactions, never reentrantly from a death callback. */
  finishHostStep(now: number): void {
    if (!this.enabled || this.destroyed) return;
    this.targets = this.targets.map(target => target && this.ports.alive(target) ? target : null);
    if (this.targets.every(target => target === null)) {
      this.targets = Array.from({ length: this.count }, (_, slot) => this.ports.spawn(slot));
    }
    // A suspended host need only reconstruct the bounded visible tail, not hours of empty samples.
    if (now - this.nextSample > SHOOTING_RANGE.historyMs) {
      this.nextSample += Math.floor((now - this.nextSample - SHOOTING_RANGE.historyMs) / SHOOTING_RANGE.sampleIntervalMs)
        * SHOOTING_RANGE.sampleIntervalMs;
    }
    while (this.nextSample <= now) {
      const at = this.nextSample;
      this.dps = this.damage.reduce((sum, event) => event.at > at - SHOOTING_RANGE.windowMs && event.at <= at
        ? sum + event.amount : sum, 0) * 1000 / SHOOTING_RANGE.windowMs;
      this.scale = Math.max(this.scale, readableScale(this.dps));
      this.samples.push({ at, dps: this.dps });
      this.nextSample += SHOOTING_RANGE.sampleIntervalMs;
    }
    this.samples = this.samples.filter(sample => sample.at >= now - SHOOTING_RANGE.historyMs);
    this.damage = this.damage.filter(event => event.at > now - SHOOTING_RANGE.windowMs);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.supply = false;
    for (const target of this.targets) if (target) this.ports.remove(target);
    this.targets = [];
    this.clearMeasurement();
  }
  private clearMeasurement(): void { this.damage = []; this.samples = []; this.dps = 0; this.scale = 100; }
}

function readableScale(value: number): number {
  if (value <= 0) return 100;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find(step => step * power >= value) ?? 10) * power;
}
