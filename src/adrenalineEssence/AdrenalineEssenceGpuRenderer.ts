import * as Phaser from 'phaser';
import { DEPTH, PLAYER_SIZE } from '../config';
import { buildGpuVfxAtlas, GPU_VFX_ATLAS_KEY } from '../effects/gpu/GpuVfxAtlas';
import { setGpuVfxTint } from '../effects/gpu/GpuVfxMember';
import { getGraphicsQualityProfile, type GraphicsQuality } from '../graphics/GraphicsQuality';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { ADRENALINE_ESSENCE_CONFIG } from './AdrenalineEssenceConfig';
import type { EssenceLightingPresentation, EssenceLightSource } from './AdrenalineEssenceLighting';
import { ESSENCE_LIQUID_BODY_DIAMETER, ESSENCE_LIQUID_PHASES, ESSENCE_LIQUID_VARIANTS,
  ESSENCE_LIQUID_TAIL_FRAME } from './AdrenalineEssenceLiquidFrames';
import {
  ESSENCE_PALETTE,
  ESSENCE_VISUAL,
  EssenceVisualSlots,
  essenceDropletCount,
  essenceSeedUnit,
  sampleEssenceFlight,
  type EssenceFlightPose,
} from './AdrenalineEssencePresentation';
import {
  essenceAccessGroupKey,
  type EssenceClusterSnapshot,
  type EssencePoint,
  type EssenceState,
  type EssenceTransferReceipt,
  type EssenceTransferSnapshot,
} from './AdrenalineEssenceTypes';

const BODY_STRIDE = ESSENCE_VISUAL.maxDroplets * 2;
const GLOW_STRIDE = ESSENCE_VISUAL.maxDroplets + 1;
const BODY_DEPTH = DEPTH.PLAYERS - 0.6;
const GLOW_DEPTH = BODY_DEPTH - 0.01;
const TWO_PI = Math.PI * 2;
const RING_RADIUS = PLAYER_SIZE / 2 + 19;
type Member = Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member>;
const DEAD_MEMBER: Member = { scaleX: 0, scaleY: 0, alpha: 0 };
type VisualMode = 'live' | 'merge' | 'return' | 'arrival' | 'fade';

interface LiquidPose {
  alpha: number;
  stretch: number;
  sizeFactor: number;
  spread: number;
  angle: number;
  flight: boolean;
  landingPulse: number;
  squash: number;
  moving: boolean;
}

interface VisualEntry {
  readonly key: string;
  readonly slot: number;
  cluster: EssenceClusterSnapshot | null;
  transfer: EssenceTransferSnapshot | null;
  mode: VisualMode;
  seen: number;
  value: number;
  visualValue: number;
  seed: number;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  terminalAt: number;
  terminalUntil: number;
  nextUpdateAt: number;
  lastCount: number;
  lastAlpha: number;
  readonly pose: LiquidPose;
  readonly light: { id: string; x: number; y: number; value: number; alpha: number };
}

export interface EssenceRendererStats {
  readonly spawnAttempts: number;
  readonly activeGroups: number;
  readonly peakGroups: number;
  readonly reconstructedDroplets: number;
  readonly bodyInstances: number;
  readonly glowInstances: number;
  readonly qualityDetailDrops: number;
  readonly capacityDrops: number;
  readonly bufferGrowths: number;
  readonly groupCapacity: number;
}

/**
 * Two shared atlas-backed GPU layers own every essence visual in this Activity. Logical
 * records own stable slots, never GameObjects, physics bodies, GPU sources or network IDs
 * per droplet. A high-water buffer grows only on state admission if an exceptional scene
 * exceeds the initial stress budget; core pearls are never evicted to admit decoration.
 */
export class AdrenalineEssenceGpuRenderer {
  private readonly body: Phaser.GameObjects.SpriteGPULayer;
  private readonly glow: Phaser.GameObjects.SpriteGPULayer;
  private readonly entries = new Map<string, VisualEntry>();
  private readonly slots = new EssenceVisualSlots();
  private readonly receipts = new Map<string, number>();
  private readonly visualRereservations = new Map<string, number>();
  private readonly member: Member = {};
  private readonly pose: EssenceFlightPose = { x: 0, y: 0, angle: 0, progress: 0 };
  private readonly target = { x: 0, y: 0 };
  private readonly lightSources: EssenceLightSource[] = [];
  private scope = '';
  private state: EssenceState | null = null;
  private syncRevision = 0;
  private lastQuality: GraphicsQuality = 'high';
  private capacity = ESSENCE_VISUAL.initialGroups as number;
  private primedGroups = 0;
  private peakGroups = 0;
  private spawnAttempts = 0;
  private bufferGrowths = 0;
  private visibleDroplets = 0;
  private visibleTails = 0;
  private detailDrops = 0;
  private suppressed = false;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getPlayerPosition: (playerId: string) => EssencePoint | null | undefined,
    private readonly lighting?: EssenceLightingPresentation,
  ) {
    buildGpuVfxAtlas(scene);
    this.glow = scene.add.spriteGPULayer(GPU_VFX_ATLAS_KEY, this.capacity * GLOW_STRIDE);
    this.glow.name = 'adrenaline-essence-glow';
    this.glow.setDepth(GLOW_DEPTH).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.body = scene.add.spriteGPULayer(GPU_VFX_ATLAS_KEY, this.capacity * BODY_STRIDE);
    this.body.name = 'adrenaline-essence-body';
    this.body.setDepth(BODY_DEPTH).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(false);
  }

  /** `now` is synchronized host time. The incoming state is already access-filtered. */
  update(state: EssenceState, now: number, receipts: readonly EssenceTransferReceipt[] = []): void {
    if (this.destroyed) return;
    const scope = `${state.worldRevision}:${state.activityRevision}`;
    if (scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
    const quality = getGraphicsQualityProfile(this.scene).level;
    const qualityChanged = quality !== this.lastQuality;
    this.lastQuality = quality;
    this.consumeReceipts(receipts, state, now);
    if (state !== this.state || state.revision !== this.state?.revision) this.sync(state, now);
    this.visibleDroplets = 0;
    this.visibleTails = 0;
    this.detailDrops = 0;
    this.lightSources.length = 0;
    if (this.suppressed) {
      for (const entry of this.entries.values()) {
        if (entry.mode !== 'live' && now >= entry.terminalUntil) this.remove(entry);
      }
      return;
    }
    for (const entry of this.entries.values()) {
      if (entry.mode !== 'live' && now >= entry.terminalUntil) {
        this.remove(entry);
        continue;
      }
      const count = essenceDropletCount(entry.value, quality, this.entries.size);
      this.visibleDroplets += count;
      this.detailDrops += essenceDropletCount(entry.value, 'high', 0) - count;
      this.samplePose(entry, now);
      if (entry.pose.flight && quality !== 'low') this.visibleTails += count;
      entry.light.x = entry.x;
      entry.light.y = entry.y;
      entry.light.value = entry.value;
      entry.light.alpha = entry.pose.alpha;
      this.lightSources.push(entry.light);
      if (!qualityChanged && count === entry.lastCount && now < entry.nextUpdateAt) continue;
      this.draw(entry, now, quality, count);
    }
    // Lighting must receive every pose even when a quiet ground material skips a GPU edit.
    const camera = this.scene.cameras?.main;
    this.lighting?.update(this.lightSources, quality, camera ? getVisibleWorldView(camera) : null);
    this.peakGroups = Math.max(this.peakGroups, this.entries.size);
    const visible = this.entries.size > 0;
    if (this.body.visible !== visible) this.body.setVisible(visible);
    if (this.glow.visible !== visible) this.glow.setVisible(visible);
  }

  clear(): void {
    this.lighting?.clear(true);
    for (const entry of this.entries.values()) this.hide(entry.slot);
    this.entries.clear();
    this.receipts.clear();
    this.visualRereservations.clear();
    this.slots.clear();
    this.state = null;
    this.scope = '';
    this.visibleDroplets = 0;
    this.visibleTails = 0;
    this.detailDrops = 0;
    this.lightSources.length = 0;
    this.body.setVisible(false);
    this.glow.setVisible(false);
  }

  /** Performance ablation suspends visual work, leaving the authoritative timeline intact. */
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    if (suppressed) this.lighting?.clear(true);
    this.body.setVisible(!suppressed && this.entries.size > 0);
    this.glow.setVisible(!suppressed && this.entries.size > 0);
    if (!suppressed) for (const entry of this.entries.values()) entry.nextUpdateAt = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.body.destroy();
    this.glow.destroy();
    this.lighting?.destroy();
    this.destroyed = true;
  }

  getStats(): EssenceRendererStats {
    return {
      spawnAttempts: this.spawnAttempts,
      activeGroups: this.entries.size,
      peakGroups: this.peakGroups,
      reconstructedDroplets: this.visibleDroplets,
      bodyInstances: this.visibleDroplets * (this.lastQuality === 'low' ? 1 : 2),
      glowInstances: this.entries.size + this.visibleTails,
      qualityDetailDrops: this.detailDrops,
      capacityDrops: 0,
      bufferGrowths: this.bufferGrowths,
      groupCapacity: this.capacity,
    };
  }

  private sync(state: EssenceState, now: number): void {
    this.state = state;
    this.syncRevision += 1;
    for (const cluster of state.clusters) {
      const entry = this.obtain(`c:${cluster.id}`, cluster.value, cluster.seed, cluster.originX, cluster.originY);
      const previous = entry.cluster;
      if (!previous || entry.mode !== 'live' || previous.value !== cluster.value
        || previous.expiresAt !== cluster.expiresAt || previous.lastExpiresAt !== cluster.lastExpiresAt
        || previous.lastMergeAt !== cluster.lastMergeAt || previous.state !== cluster.state
        || previous.x !== cluster.x || previous.y !== cluster.y) entry.nextUpdateAt = 0;
      entry.cluster = cluster;
      entry.transfer = null;
      entry.mode = 'live';
      entry.value = cluster.value;
      entry.seen = this.syncRevision;
    }
    for (const transfer of state.transfers) {
      if (this.receipts.has(transfer.id)) continue;
      const entry = this.obtain(`t:${transfer.id}`, transfer.value, transfer.seed, transfer.sourceX, transfer.sourceY);
      entry.transfer = transfer;
      entry.cluster = null;
      entry.mode = 'live';
      entry.value = transfer.value;
      entry.seen = this.syncRevision;
      entry.nextUpdateAt = 0;
    }
    for (const entry of this.entries.values()) {
      if (entry.mode !== 'live' || entry.seen === this.syncRevision) continue;
      const cluster = entry.cluster;
      if (cluster && now < cluster.expiresAt
        && !state.transfers.some((transfer) => transfer.clusterId === cluster.id)) {
        // Only a host-confirmed merge target can attract a disappearing source. This small
        // visual association never influences the anchor, stored value or merge admission.
        let target: EssenceClusterSnapshot | null = null;
        let distance = ADRENALINE_ESSENCE_CONFIG.mergeRadius + 0.001;
        for (const candidate of state.clusters) {
          if (candidate.lastMergeAt === undefined || now - candidate.lastMergeAt > ESSENCE_VISUAL.mergeMs
            || essenceAccessGroupKey(candidate.accessGroup) !== essenceAccessGroupKey(cluster.accessGroup)) continue;
          const d = Math.hypot(candidate.x - cluster.x, candidate.y - cluster.y);
          if (d < distance) { target = candidate; distance = d; }
        }
        if (target) {
          this.finish(entry, 'merge', now, ESSENCE_VISUAL.mergeMs, target.x, target.y);
          continue;
        }
      }
      // A missing receipt/full resync may remove a transfer. It must never imply an arrival.
      this.finish(entry, 'fade', now, ESSENCE_VISUAL.vanishMs, entry.x, entry.y);
    }
  }

  private consumeReceipts(receipts: readonly EssenceTransferReceipt[], state: EssenceState, now: number): void {
    this.visualRereservations.clear();
    for (const receipt of receipts) {
      if (receipt.worldRevision !== state.worldRevision || receipt.activityRevision !== state.activityRevision
        || this.receipts.has(receipt.id)) continue;
      this.receipts.set(receipt.id, receipt.completedAt);
      const entry = this.entries.get(`t:${receipt.id}`);
      if (now - receipt.completedAt > ESSENCE_VISUAL.receiptMaxAgeMs) {
        if (entry) this.remove(entry);
        continue;
      }
      let visibleReturn = receipt.returnedValue;
      if (visibleReturn > 0) {
        for (const next of state.transfers) {
          if (next.id === receipt.id || next.startedAt < receipt.completedAt
            || (entry?.transfer ? next.clusterId !== entry.transfer.clusterId
              : next.sourceX !== receipt.sourceX || next.sourceY !== receipt.sourceY
                || essenceAccessGroupKey(next.accessGroup) !== essenceAccessGroupKey(receipt.accessGroup))) continue;
          const consumed = this.visualRereservations.get(next.id) ?? 0;
          const used = Math.min(visibleReturn, Math.max(0, next.value - consumed));
          visibleReturn -= used;
          this.visualRereservations.set(next.id, consumed + used);
          if (visibleReturn <= 0) break;
        }
      }
      // Host cancellation and a new reservation may happen in the same tick. The new
      // confirmed flight owns that visual portion immediately; do not draw it a second time
      // as a returning source pearl. Only the genuinely free remainder flows back.
      if (visibleReturn > 0) {
        const returning = entry ?? this.obtain(`t:${receipt.id}`, visibleReturn, 0, receipt.targetX, receipt.targetY);
        returning.value = visibleReturn;
        this.finish(returning, 'return', now, ESSENCE_VISUAL.returnMs, receipt.sourceX, receipt.sourceY);
      } else if (entry) {
        if (receipt.creditedValue > 0) {
          const target = this.playerTarget(receipt.playerId, receipt.targetX, receipt.targetY);
          entry.x = target.x;
          entry.y = target.y;
          entry.value = receipt.creditedValue;
          this.finish(entry, 'arrival', now, ESSENCE_VISUAL.arrivalMs, target.x, target.y);
        } else if (receipt.returnedValue > 0) {
          this.remove(entry);
        } else {
          this.finish(entry, 'fade', now, ESSENCE_VISUAL.vanishMs, entry.x, entry.y);
        }
      }
      // Partial commit + return shows both outcomes, scaled to their actual portions.
      if (receipt.creditedValue > 0 && (!entry || visibleReturn > 0)) {
        const target = this.playerTarget(receipt.playerId, receipt.targetX, receipt.targetY);
        const arrival = this.obtain(`a:${receipt.id}`, receipt.creditedValue, 0, target.x, target.y);
        this.finish(arrival, 'arrival', now, ESSENCE_VISUAL.arrivalMs, target.x, target.y);
      }
    }
    for (const [id, completedAt] of this.receipts) {
      if (now - completedAt > ESSENCE_VISUAL.receiptMaxAgeMs) this.receipts.delete(id);
    }
  }

  private obtain(key: string, value: number, seed: number, x: number, y: number): VisualEntry {
    const previous = this.entries.get(key);
    if (previous) return previous;
    this.spawnAttempts++;
    const slot = this.slots.acquire(key);
    if (slot >= this.capacity) {
      while (slot >= this.capacity) this.capacity *= 2;
      this.body.resize(this.capacity * BODY_STRIDE);
      this.glow.resize(this.capacity * GLOW_STRIDE);
      this.bufferGrowths += 1;
    }
    while (this.primedGroups <= slot) {
      for (let i = 0; i < BODY_STRIDE; i++) this.body.addMember(DEAD_MEMBER);
      for (let i = 0; i < GLOW_STRIDE; i++) this.glow.addMember(DEAD_MEMBER);
      this.primedGroups++;
    }
    const entry: VisualEntry = {
      key, slot, value, visualValue: value, seed, x, y, fromX: x, fromY: y, toX: x, toY: y,
      mode: 'live', cluster: null, transfer: null, seen: this.syncRevision,
      terminalAt: 0, terminalUntil: 0, nextUpdateAt: 0, lastCount: 0, lastAlpha: 1,
      pose: { alpha: 1, stretch: 1, sizeFactor: 1, spread: 1, angle: 0,
        flight: false, landingPulse: 0, squash: 0, moving: false },
      light: { id: key, x, y, value, alpha: 1 },
    };
    this.entries.set(key, entry);
    return entry;
  }

  private finish(entry: VisualEntry, mode: VisualMode, now: number, duration: number, x: number, y: number): void {
    entry.mode = mode;
    entry.fromX = entry.x;
    entry.fromY = entry.y;
    entry.toX = x;
    entry.toY = y;
    entry.terminalAt = now;
    entry.terminalUntil = now + duration;
    entry.nextUpdateAt = 0;
  }

  private samplePose(entry: VisualEntry, now: number): void {
    const cluster = entry.cluster;
    const transfer = entry.transfer;
    let alpha = 1;
    let stretch = 1;
    let sizeFactor = 1;
    let spread = 1;
    let angle = essenceSeedUnit(entry.seed, 0) * TWO_PI;
    let flight = false;
    let landingPulse = 0;
    let squash = 0;
    let moving = false;
    if (entry.mode !== 'live') {
      const t = clamp((now - entry.terminalAt) / Math.max(1, entry.terminalUntil - entry.terminalAt));
      const ease = 1 - (1 - t) ** 3;
      entry.x = entry.fromX + (entry.toX - entry.fromX) * ease;
      entry.y = entry.fromY + (entry.toY - entry.fromY) * ease;
      alpha = (1 - t) * (entry.mode === 'return' ? 0.66 : entry.mode === 'fade' ? entry.lastAlpha : 1);
      angle = Math.atan2(entry.toY - entry.fromY, entry.toX - entry.fromX);
      flight = entry.mode === 'return' || entry.mode === 'merge';
      stretch = flight ? 1.7 : 1;
      spread = 1 - t;
      sizeFactor = entry.mode === 'arrival' ? 0.8 + t * 0.4 : Math.max(0.15, 1 - t * 0.72);
      landingPulse = entry.mode === 'arrival' ? Math.sin(t * Math.PI) * 0.8 : 0;
      moving = true;
    } else if (transfer) {
      const target = this.playerTarget(transfer.playerId, transfer.targetX, transfer.targetY);
      const pose = sampleEssenceFlight(transfer, now, target, this.pose);
      entry.x = pose.x;
      entry.y = pose.y;
      angle = pose.angle;
      flight = true;
      stretch = 1.3 + 1.5 * pose.progress ** 2;
      spread = Math.max(0.08, 1 - pose.progress);
      // Flight completion without a receipt is quiet; resource/HUD authority remains separate.
      alpha = now <= transfer.arrivalAt ? 1 : clamp(1 - (now - transfer.arrivalAt) / ESSENCE_VISUAL.incomingGraceMs);
      moving = true;
    } else if (cluster) {
      const t = clamp((now - cluster.createdAt) / Math.max(1, cluster.landAt - cluster.createdAt));
      const airborne = now < cluster.landAt;
      const eased = 1 - (1 - t) ** 3;
      const height = Math.sin(t * Math.PI) * (8 + essenceSeedUnit(entry.seed, 2) * 7);
      entry.x = cluster.originX + (cluster.x - cluster.originX) * eased;
      entry.y = cluster.originY + (cluster.y - cluster.originY) * eased - height;
      if (airborne) {
        angle = Math.atan2(cluster.y - cluster.originY - Math.cos(t * Math.PI) * 17, cluster.x - cluster.originX);
        stretch = 1.8 - 0.7 * t;
        spread = t;
        flight = true;
        alpha = Math.min(1, t * 6 + 0.35);
      } else {
        entry.x = cluster.x;
        entry.y = cluster.y;
        landingPulse = Math.max(0, 1 - (now - cluster.landAt) / ESSENCE_VISUAL.landingPulseMs);
        const mergePulse = cluster.lastMergeAt === undefined ? 0
          : Math.max(0, 1 - (now - cluster.lastMergeAt) / ESSENCE_VISUAL.mergeMs);
        // Surface-tension settling: immediate flatten, a small recoil, then a quiet pearl.
        const landingAge = Math.max(0, now - cluster.landAt);
        squash = landingPulse * 0.27 * Math.cos(landingAge / ESSENCE_VISUAL.landingPulseMs * Math.PI * 2);
        sizeFactor = 1 + Math.sin(mergePulse * Math.PI) * 0.18;
        // Expiry buckets can coexist after merge. Fading the entire cluster at the first
        // bucket deadline would make its surviving value disappear and reappear on upsert.
        const remaining = (cluster.lastExpiresAt ?? cluster.expiresAt) - now;
        if (remaining < ESSENCE_VISUAL.expiryWarningMs) {
          const expiry = clamp(remaining / ESSENCE_VISUAL.expiryWarningMs);
          alpha = Math.sqrt(expiry);
          sizeFactor *= 0.65 + 0.35 * expiry;
        }
      }
      moving = airborne || landingPulse > 0;
    }
    const pose = entry.pose;
    pose.alpha = alpha;
    pose.stretch = stretch;
    pose.sizeFactor = sizeFactor;
    pose.spread = spread;
    pose.angle = angle;
    pose.flight = flight;
    pose.landingPulse = landingPulse;
    pose.squash = squash;
    pose.moving = moving;
    if (entry.mode === 'live') entry.lastAlpha = alpha;
  }

  private draw(entry: VisualEntry, now: number, quality: GraphicsQuality, count: number): void {
    const { alpha, stretch, sizeFactor, spread, angle, flight, landingPulse, squash, moving } = entry.pose;
    entry.nextUpdateAt = moving ? now : now
      + (quality === 'low' ? ESSENCE_VISUAL.lowQualityGroundRefreshMs : ESSENCE_VISUAL.groundRefreshMs);
    entry.visualValue += (entry.value - entry.visualValue) * 0.3;
    const baseDiameter = ESSENCE_VISUAL.minimumDiameterPx + Math.min(ESSENCE_VISUAL.maximumDiameterGrowthPx,
      Math.log2(1 + entry.visualValue) * ESSENCE_VISUAL.valueDiameterFactor);
    const groupPhase = essenceSeedUnit(entry.seed, 5) * TWO_PI;
    const wobble = quality === 'low' || this.entries.size > ESSENCE_VISUAL.reducedDensityAfter ? 0
      : Math.sin(now * ESSENCE_VISUAL.wobbleRate + groupPhase) * ESSENCE_VISUAL.wobbleAmplitude;
    const haloScale = baseDiameter * (ESSENCE_VISUAL.haloScale + count * ESSENCE_VISUAL.haloPerDropletScale
      + landingPulse * ESSENCE_VISUAL.haloLandingScale) / 24;
    this.write(this.glow, entry.slot * GLOW_STRIDE, 'death-glow', entry.x, entry.y,
      haloScale, haloScale * 0.78, 0, ESSENCE_PALETTE.halo,
      alpha * (quality === 'low' ? ESSENCE_VISUAL.lowQualityHaloAlpha : ESSENCE_VISUAL.haloAlpha)
        * (entry.mode === 'return' ? 0.55 : 1));
    for (let i = 0; i < count; i++) {
      const phase = essenceSeedUnit(entry.seed, i * 4 + 10) * TWO_PI;
      const radius = i === 0 ? 0 : (2.8 + essenceSeedUnit(entry.seed, i * 4 + 11) * 2.8) * spread;
      const x = entry.x + Math.cos(phase) * radius;
      const y = entry.y + Math.sin(phase) * radius * 0.84;
      const scaleClass = i === 0 ? 1 : essenceSeedUnit(entry.seed, i * 4 + 12) < 0.55
        ? ESSENCE_VISUAL.smallDropletScale : ESSENCE_VISUAL.mediumDropletScale;
      const diameter = baseDiameter * scaleClass * sizeFactor;
      const dropletAngle = flight ? angle : 0;
      const bodyX = diameter * stretch * (1 + wobble + squash) / ESSENCE_LIQUID_BODY_DIAMETER;
      const bodyY = diameter * (1 - wobble - squash) / ESSENCE_LIQUID_BODY_DIAMETER;
      const bodySlot = entry.slot * BODY_STRIDE + i * 2;
      const variant = Math.floor(essenceSeedUnit(entry.seed, i * 4 + 13) * ESSENCE_LIQUID_VARIANTS);
      const materialTime = quality === 'low' ? 0 : ((now / ESSENCE_VISUAL.materialCycleMs
        + essenceSeedUnit(entry.seed, i * 4 + 14)) % 1) * ESSENCE_LIQUID_PHASES;
      const materialPhase = Math.floor(materialTime);
      const mix = materialTime - materialPhase;
      // Two normal-blended atlas phases retain total opacity in their shared interior;
      // coloured material owns the reflection, so no white additive pinprick is required.
      const topAlpha = alpha * mix;
      const bottomAlpha = alpha * (1 - mix) / Math.max(0.001, 1 - topAlpha);
      this.write(this.body, bodySlot, `essence-liquid-${variant}-${materialPhase}`, x, y,
        bodyX, bodyY, dropletAngle, 0xffffff, bottomAlpha);
      this.write(this.body, bodySlot + 1, `essence-liquid-${variant}-${(materialPhase + 1) % ESSENCE_LIQUID_PHASES}`,
        x, y, bodyX, bodyY, dropletAngle, 0xffffff, topAlpha);
      const glowSlot = entry.slot * GLOW_STRIDE + i + 1;
      if (flight && quality !== 'low') {
        const trailLength = diameter * (stretch * 1.8);
        this.write(this.glow, glowSlot, ESSENCE_LIQUID_TAIL_FRAME,
          x - Math.cos(dropletAngle) * trailLength * 0.3,
          y - Math.sin(dropletAngle) * trailLength * 0.3,
          trailLength / 28, diameter * 0.62 / 10, dropletAngle, 0xffffff, alpha * 0.31);
      } else {
        this.glow.editMember(glowSlot, DEAD_MEMBER);
      }
    }
    for (let i = count; i < entry.lastCount; i++) {
      this.body.editMember(entry.slot * BODY_STRIDE + i * 2, DEAD_MEMBER);
      this.body.editMember(entry.slot * BODY_STRIDE + i * 2 + 1, DEAD_MEMBER);
      this.glow.editMember(entry.slot * GLOW_STRIDE + i + 1, DEAD_MEMBER);
    }
    entry.lastCount = count;
  }

  private playerTarget(playerId: string, fallbackX: number, fallbackY: number): EssencePoint {
    const position = this.getPlayerPosition(playerId);
    this.target.x = (position?.x ?? fallbackX) + RING_RADIUS * 0.866;
    this.target.y = (position?.y ?? fallbackY) - RING_RADIUS * 0.5;
    return this.target;
  }

  private write(layer: Phaser.GameObjects.SpriteGPULayer, slot: number, frame: string,
    x: number, y: number, scaleX: number, scaleY: number, rotation: number, tint: number, alpha: number): void {
    const member = this.member;
    member.frame = frame;
    member.x = x;
    member.y = y;
    member.scaleX = scaleX;
    member.scaleY = scaleY;
    member.rotation = rotation;
    member.alpha = Math.max(0, alpha);
    setGpuVfxTint(member, tint);
    layer.editMember(slot, member);
  }

  private hide(slot: number): void {
    for (let i = 0; i < BODY_STRIDE; i++) this.body.editMember(slot * BODY_STRIDE + i, DEAD_MEMBER);
    for (let i = 0; i < GLOW_STRIDE; i++) this.glow.editMember(slot * GLOW_STRIDE + i, DEAD_MEMBER);
  }

  private remove(entry: VisualEntry): void {
    this.hide(entry.slot);
    this.entries.delete(entry.key);
    this.slots.release(entry.key);
  }
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
