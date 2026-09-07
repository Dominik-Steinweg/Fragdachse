import type { GraphicsQuality } from '../graphics/GraphicsQuality';
import type {
  EssencePoint,
  EssenceState,
  EssenceTransferReceipt,
  EssenceTransferSnapshot,
} from './AdrenalineEssenceTypes';

/** Cosmetic timing only: none of these values changes reservation, expiry or resource state. */
export const ESSENCE_VISUAL = {
  initialGroups: 512,
  maxDroplets: 5,
  expiryWarningMs: 1_350,
  returnMs: 210,
  mergeMs: 190,
  vanishMs: 140,
  arrivalMs: 170,
  receiptMaxAgeMs: 650,
  incomingGraceMs: 150,
  hudBundleMs: 110,
  minimumDiameterPx: 4.8,
  maximumDiameterGrowthPx: 2.4,
  valueDiameterFactor: 0.5,
  smallDropletScale: 0.55,
  mediumDropletScale: 0.77,
  mediumQualityDroplets: 2,
  lowQualityDroplets: 1,
  reducedDensityAfter: 300,
  minimumDensityAfter: 640,
  groundRefreshMs: 33,
  lowQualityGroundRefreshMs: 90,
  landingPulseMs: 180,
  wobbleAmplitude: 0.045,
  wobbleRate: 0.0016,
  materialCycleMs: 3_600,
  haloScale: 2.7,
  haloPerDropletScale: 0.17,
  haloLandingScale: 0.6,
  haloAlpha: 0.25,
  lowQualityHaloAlpha: 0.17,
  flightInitialSpeedFraction: 0.12,
  flightMaximumBendPx: 17,
  flightBendDistanceFraction: 0.12,
} as const;

/** World droplets and explicit ring feedback share the same blue/cyan identity. */
export const ESSENCE_PALETTE = {
  rim: 0x165c80,
  body: 0x35bfd3,
  light: 0x9dece8,
  halo: 0x319ed1,
} as const;

export interface EssenceHudPort {
  setEssenceIncoming(value: number): void;
  notifyEssenceArrival(creditedValue: number, completionAgeMs?: number): void;
}

/**
 * A resource snapshot can arrive before its cosmetic receipt. Remember only gain feedback
 * already displayed, so that receipt can continue the same envelope without celebrating it
 * again after it faded. Amounts here are visual accounting, never a resource authority.
 */
export class EssenceArrivalBurst {
  private readonly genericGains: { at: number; value: number; until: number }[] = [];
  private bundleStartedAt = -Infinity;
  private burstUntil = 0;
  private burstValue = 0;

  constructor(private readonly durationMs: number) {}
  get until(): number { return this.burstUntil; }
  get value(): number { return this.burstValue; }

  recordGenericGain(value: number, now: number): void {
    this.prune(now);
    if (value > 0) this.genericGains.push({ at: now, value, until: now + this.durationMs });
  }

  recordArrival(value: number, now: number, completionAgeMs: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.prune(now);
    const completedAt = now - Math.max(0, completionAgeMs);
    const roundingTolerance = value * 1e-12;
    let uncovered = value;
    let matchingUntil = 0;
    for (const gain of this.genericGains) {
      // A genuinely later arrival must not consume an older event's generic burst.
      if (gain.at + 1 < completedAt || gain.value <= 0) continue;
      const covered = Math.min(uncovered, gain.value);
      uncovered -= covered;
      gain.value -= covered;
      matchingUntil = Math.max(matchingUntil, gain.until);
      if (uncovered <= roundingTolerance) break;
    }
    if (uncovered > roundingTolerance) this.add(uncovered, now, now + this.durationMs);
    else if (matchingUntil > now) this.add(value, now, matchingUntil);
  }

  clear(): void {
    this.genericGains.length = 0;
    this.bundleStartedAt = -Infinity;
    this.burstUntil = 0;
    this.burstValue = 0;
  }

  private add(value: number, now: number, until: number): void {
    if (now - this.bundleStartedAt > ESSENCE_VISUAL.hudBundleMs) {
      this.bundleStartedAt = now;
      this.burstValue = 0;
    }
    this.burstValue += value;
    this.burstUntil = Math.max(this.burstUntil, until);
  }

  private prune(now: number): void {
    while (this.genericGains.length && now - this.genericGains[0].at > ESSENCE_VISUAL.receiptMaxAgeMs) {
      this.genericGains.shift();
    }
  }
}

/**
 * Explicit, bounded terminal feedback. Resource snapshots are intentionally absent from this
 * port: neither an attractive flight nor a lost cosmetic packet can delay a resource update.
 */
export class AdrenalineEssencePresentation {
  private scope = '';
  private localPlayerId = '';
  private state: EssenceState | null = null;
  private incoming = 0;
  private readonly received = new Map<string, number>();
  private readonly arrivalBatches = new Map<number, number>();

  constructor(private readonly hud: EssenceHudPort) {}

  sync(
    state: EssenceState,
    receipts: readonly EssenceTransferReceipt[],
    now: number,
    localPlayerId: string,
    options: { historical?: boolean } = {},
  ): void {
    const scope = `${state.worldRevision}:${state.activityRevision}`;
    if (scope !== this.scope || localPlayerId !== this.localPlayerId) {
      this.clear();
      this.scope = scope;
      this.localPlayerId = localPlayerId;
    }
    this.state = state;
    this.arrivalBatches.clear();
    for (const receipt of receipts) {
      if (receipt.worldRevision !== state.worldRevision
        || receipt.activityRevision !== state.activityRevision
        || this.received.has(receipt.id)) continue;
      this.received.set(receipt.id, receipt.completedAt);
      if (!options.historical
        && receipt.playerId === localPlayerId
        && receipt.creditedValue > 0
        && now - receipt.completedAt <= ESSENCE_VISUAL.receiptMaxAgeMs) {
        this.arrivalBatches.set(receipt.completedAt,
          (this.arrivalBatches.get(receipt.completedAt) ?? 0) + receipt.creditedValue);
      }
    }
    // The age gate also keeps a replay inert after its dedup entry has been pruned.
    for (const [id, completedAt] of this.received) {
      if (now - completedAt > ESSENCE_VISUAL.receiptMaxAgeMs) this.received.delete(id);
    }
    for (const [completedAt, credited] of this.arrivalBatches) {
      this.hud.notifyEssenceArrival(credited, Math.max(0, now - completedAt));
    }
    this.update(now);
  }

  update(now: number): void {
    let incoming = 0;
    for (const transfer of this.state?.transfers ?? []) {
      if (transfer.playerId === this.localPlayerId
        && !this.received.has(transfer.id)
        && now < transfer.arrivalAt + ESSENCE_VISUAL.incomingGraceMs) {
        incoming += transfer.value;
      }
    }
    if (incoming !== this.incoming) {
      this.incoming = incoming;
      this.hud.setEssenceIncoming(incoming);
    }
  }

  clear(): void {
    this.state = null;
    this.received.clear();
    this.arrivalBatches.clear();
    this.scope = '';
    this.localPlayerId = '';
    this.incoming = 0;
    this.hud.setEssenceIncoming(0);
  }
}

/** Keep the same GPU slots through upserts, LOD changes, merges and transfer tracking. */
export class EssenceVisualSlots {
  private readonly slots = new Map<string, number>();
  private readonly free: number[] = [];
  private next = 0;

  acquire(id: string): number {
    const existing = this.slots.get(id);
    if (existing !== undefined) return existing;
    const slot = this.free.pop() ?? this.next++;
    this.slots.set(id, slot);
    return slot;
  }

  release(id: string): void {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    this.slots.delete(id);
    this.free.push(slot);
  }

  clear(): void {
    this.slots.clear();
    this.free.length = 0;
    this.next = 0;
  }
}

/** Value affects density and a bounded size class, never a fixed points-per-droplet rule. */
export function essenceDropletCount(value: number, quality: GraphicsQuality, visibleGroups: number): number {
  // A normal split hit reads as a single fluid pearl. Satellites decorate larger pools only.
  const authored = Math.min(ESSENCE_VISUAL.maxDroplets, 1 + Math.floor(Math.log2(1 + Math.max(0, value) / 6)));
  const qualityLimit = quality === 'low' ? ESSENCE_VISUAL.lowQualityDroplets
    : quality === 'medium' ? ESSENCE_VISUAL.mediumQualityDroplets : ESSENCE_VISUAL.maxDroplets;
  const densityLimit = visibleGroups > ESSENCE_VISUAL.minimumDensityAfter ? 1
    : visibleGroups > ESSENCE_VISUAL.reducedDensityAfter ? 2 : ESSENCE_VISUAL.maxDroplets;
  return Math.max(1, Math.min(authored, qualityLimit, densityLimit));
}

export function essenceSeedUnit(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 0x1_0000_0000;
}

export interface EssenceFlightPose {
  x: number;
  y: number;
  angle: number;
  progress: number;
}

/** Current player position is sampled locally; late packets use the remaining host timeline. */
export function sampleEssenceFlight(
  transfer: EssenceTransferSnapshot,
  now: number,
  target: EssencePoint | null | undefined,
  out: EssenceFlightPose,
): EssenceFlightPose {
  const progress = Math.max(0, Math.min(1,
    (now - transfer.startedAt) / Math.max(1, transfer.arrivalAt - transfer.startedAt)));
  const accelerated = ESSENCE_VISUAL.flightInitialSpeedFraction * progress
    + (1 - ESSENCE_VISUAL.flightInitialSpeedFraction) * progress * progress * progress;
  const targetX = target?.x ?? transfer.targetX;
  const targetY = target?.y ?? transfer.targetY;
  const dx = targetX - transfer.sourceX;
  const dy = targetY - transfer.sourceY;
  const length = Math.hypot(dx, dy);
  const bend = Math.sin(progress * Math.PI)
    * Math.min(ESSENCE_VISUAL.flightMaximumBendPx, length * ESSENCE_VISUAL.flightBendDistanceFraction)
    * (essenceSeedUnit(transfer.seed, 9) > 0.5 ? 1 : -1);
  out.x = transfer.sourceX + dx * accelerated - dy / Math.max(1, length) * bend;
  out.y = transfer.sourceY + dy * accelerated + dx / Math.max(1, length) * bend;
  out.angle = Math.atan2(dy, dx);
  out.progress = progress;
  return out;
}
