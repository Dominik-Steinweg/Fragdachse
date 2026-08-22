import * as Phaser from 'phaser';
import type { GroundFireVisualStyle, SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../types';
import {
  FLAME_JET_TINTS_COOL,
  FLAME_JET_TINTS_HOT,
  FLAME_JET_TINTS_MID,
  VOID_JET_TINTS_COOL,
  VOID_JET_TINTS_HOT,
  VOID_JET_TINTS_MID,
} from './FlameShared';
import {
  buildGroundFireClusterLayouts,
  groundFireCellsSignature,
  type GroundFireClusterLayout,
} from './GroundFireClusters';
import { GROUND_FIRE_CELL_SIZE } from './FireSystem';
import { GROUND_FIRE_LIGHT_BUCKET_SIZE, MAX_GROUND_FIRE_LIGHTS } from './LightingConfig';
import type { LightingSystem } from './LightingSystem';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

const TWO_PI = Math.PI * 2;
const GROUND_FIRE_BODY_LIFESPAN = { min: 680, max: 940 };
const GROUND_FIRE_BILLOW_LIFESPAN = { min: 390, max: 760 };
const GROUND_FIRE_TONGUE_LIFESPAN = { min: 270, max: 520 };
const GROUND_FIRE_SPARK_LIFESPAN = { min: 300, max: 680 };
const GROUND_FIRE_HEAT_BODY_FREQUENCY_MS = 360;
const GROUND_FIRE_BILLOW_FREQUENCY_MS = 128;
const GROUND_FIRE_TONGUE_FREQUENCY_MS = 174;
const GROUND_FIRE_SPARK_FREQUENCY_MS = 520;
const GROUND_FIRE_SMOKE_FREQUENCY_MS = 780;
const GROUND_FIRE_FADE_MS = 420;
const MAX_HEAT_BODIES_PER_CLUSTER = 3;
const MAX_BILLOWS_PER_CLUSTER = 6;
const MAX_TONGUES_PER_CLUSTER = 3;
const MAX_SPARKS_PER_CLUSTER = 3;

interface GroundFireNode {
  role: 'billow' | 'tongue';
  x: number;
  y: number;
  heat: number;
  size: number;
  phase: number;
  rotation: number;
  angularVelocity: number;
  driftX: number;
  driftY: number;
  seed: number;
}

interface GroundFireCluster {
  id: string;
  seed: number;
  visualStyle: GroundFireVisualStyle;
  cells: readonly SyncedBurningGroundCell[];
  layoutSignature: string;
  centerX: number;
  centerY: number;
  widthPx: number;
  heightPx: number;
  totalIntensity: number;
  maxIntensity: number;
  expiresAt: number;
  bornAt: number;
  phase: number;
  billowCount: number;
  tongueCount: number;
  heatBodyCount: number;
  sparkCount: number;
  billowCursor: number;
  tongueCursor: number;
  bodyCursor: number;
  sparkCursor: number;
  heatBodyFlow: ParticleFlowScheduler;
  billowFlow: ParticleFlowScheduler;
  tongueFlow: ParticleFlowScheduler;
  sparkFlow: ParticleFlowScheduler;
  smokeFlow: ParticleFlowScheduler;
  nodes: GroundFireNode[];
}

interface GroundFireLightRecord {
  key: string;
  clusterId: string;
  x: number;
  y: number;
  weight: number;
  radiusPx: number;
  intensity: number;
  visualStyle: GroundFireVisualStyle;
}

/**
 * Cluster-only visual backend for persistent ground fire.
 *
 * It owns no Phaser GameObjects. Stable node data is sampled by a bounded set of GPUFX flows;
 * the shared GPUFX source and pooled SpriteGPULayers remain the only flame renderer.
 */
export class GroundFireClusterRenderer {
  private readonly clusters = new Map<string, GroundFireCluster>();
  private readonly lightRecords = new Map<string, GroundFireLightRecord>();
  private readonly activeLightKeys = new Set<string>();
  private readonly lightRanking: GroundFireLightRecord[] = [];
  private snapshotSignature = '';
  private gpuVfx: GpuVfxSystem | null = null;
  private heatBodySpec: GpuVfxSpawnSpec | null = null;
  private billowSpec: GpuVfxSpawnSpec | null = null;
  private tongueSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;
  private smokeSpec: GpuVfxSpawnSpec | null = null;
  private source = GPU_VFX_NO_SOURCE_HANDLE;
  private lighting: LightingSystem | null = null;
  /** Network/world clock used for expiry; GPUFX has its own relative particle clock. */
  private synchronizedNow = 0;

  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;

    const heatBody = system.createSpec(GpuVfxEffectId.GroundFireHeatBody);
    heatBody.frame = GpuVfxFrameId.FlameBillow;
    heatBody.yMode = GpuVfxEase.Linear;
    heatBody.scaleEase = GpuVfxEase.QuadOut;
    heatBody.alphaStart = 0.19;
    heatBody.alphaEnd = 0;
    heatBody.tintBlendStart = 0.82;
    heatBody.tintBlendEnd = 1;
    this.heatBodySpec = heatBody;

    const billow = system.createSpec(GpuVfxEffectId.GroundFireOuter);
    billow.frame = GpuVfxFrameId.FlameBillow;
    billow.yMode = GpuVfxEase.Linear;
    billow.scaleEase = GpuVfxEase.QuadOut;
    billow.alphaStart = 0.48;
    billow.alphaEnd = 0;
    billow.tintBlendStart = 0.9;
    billow.tintBlendEnd = 1;
    this.billowSpec = billow;

    const tongue = system.createSpec(GpuVfxEffectId.GroundFireCore);
    tongue.frame = GpuVfxFrameId.FlameTongue;
    tongue.yMode = GpuVfxEase.Linear;
    tongue.scaleEase = GpuVfxEase.QuadOut;
    tongue.alphaStart = 0.68;
    tongue.alphaEnd = 0;
    tongue.tintBlendStart = 0.64;
    tongue.tintBlendEnd = 1;
    this.tongueSpec = tongue;

    const spark = system.createSpec(GpuVfxEffectId.GroundFireSpark);
    spark.frame = GpuVfxFrameId.FlameSpark;
    spark.yMode = GpuVfxEase.Linear;
    spark.scaleStart = 0.72;
    spark.scaleEnd = 0.04;
    spark.alphaStart = 0.9;
    spark.alphaEnd = 0;
    this.sparkSpec = spark;

    const smoke = system.createSpec(GpuVfxEffectId.GroundFireSmoke);
    smoke.yMode = GpuVfxEase.Linear;
    smoke.scaleStart = 0.3;
    smoke.scaleEnd = 0.72;
    smoke.alphaStart = 0.12;
    smoke.alphaEnd = 0;
    this.smokeSpec = smoke;

    this.source = system.createSource(GpuVfxEffectId.GroundFireOuter);
    system.registerEmission((deltaMs, nowMs) => this.emit(deltaMs, nowMs));
  }

  syncGround(snapshot: SyncedBurningGroundSnapshot, now = Date.now()): void {
    this.synchronizedNow = now;
    const signature = groundFireCellsSignature(snapshot.cells);
    if (signature === this.snapshotSignature) return;
    this.snapshotSignature = signature;

    const layouts = buildGroundFireClusterLayouts(snapshot.cells, GROUND_FIRE_CELL_SIZE);
    const nextClusters = new Map<string, GroundFireCluster>();
    for (const layout of layouts) {
      const existing = this.clusters.get(layout.id);
      const cluster = existing ?? this.createCluster(layout);
      this.applyLayout(cluster, layout);
      nextClusters.set(cluster.id, cluster);
    }

    this.clusters.clear();
    for (const [id, cluster] of nextClusters) this.clusters.set(id, cluster);
  }

  update(now: number): void {
    this.synchronizedNow = now;
    for (const [id, cluster] of this.clusters) {
      if (cluster.expiresAt <= now) this.clusters.delete(id);
    }
    this.syncLights(now);
  }

  spawnImpact(x: number, y: number, visualStyle: GroundFireVisualStyle): void {
    if (!this.gpuVfx || this.gpuVfx.isSuppressed()) return;
    const nowMs = this.gpuVfx.now();
    const seed = this.hashPosition(x, y);
    this.spawnBillowAt(x, y, 1.0, 0.76, visualStyle, seed, nowMs);
    this.spawnBillowAt(x + 4, y - 2, 0.8, 0.64, visualStyle, seed ^ 0x41, nowMs);
    this.spawnTongueAt(x, y, 0.86, 0.92, visualStyle, seed ^ 0x83, nowMs);
    this.spawnSparkAt(x, y, 0.9, visualStyle, seed ^ 0xc7, nowMs);
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    if (!lighting && this.lighting) {
      for (const key of this.activeLightKeys) this.lighting.releaseLight(`groundfire:${key}`);
      this.activeLightKeys.clear();
      this.lightRecords.clear();
    }
    this.lighting = lighting;
  }

  clear(): void {
    this.clusters.clear();
    this.snapshotSignature = '';
    this.synchronizedNow = 0;
    this.gpuVfx?.clearSource(this.source);
    this.resetQualityCarry();
    for (const key of this.activeLightKeys) this.lighting?.releaseLight(`groundfire:${key}`);
    this.activeLightKeys.clear();
    this.lightRecords.clear();
    this.lightRanking.length = 0;
  }

  destroyAll(): void {
    this.clear();
  }

  private createCluster(layout: GroundFireClusterLayout): GroundFireCluster {
    return {
      id: layout.id,
      seed: layout.seed,
      visualStyle: layout.visualStyle,
      cells: layout.cells,
      layoutSignature: '',
      centerX: layout.centerX,
      centerY: layout.centerY,
      widthPx: layout.widthPx,
      heightPx: layout.heightPx,
      totalIntensity: layout.totalIntensity,
      maxIntensity: layout.maxIntensity,
      expiresAt: layout.expiresAt,
      bornAt: this.gpuVfx?.now() ?? 0,
      phase: this.seededUnit(layout.seed, 17) * TWO_PI,
      billowCount: 0,
      tongueCount: 0,
      heatBodyCount: 0,
      sparkCount: 0,
      billowCursor: 0,
      tongueCursor: 0,
      bodyCursor: 0,
      sparkCursor: 0,
      heatBodyFlow: new ParticleFlowScheduler(GROUND_FIRE_HEAT_BODY_FREQUENCY_MS),
      billowFlow: new ParticleFlowScheduler(GROUND_FIRE_BILLOW_FREQUENCY_MS),
      tongueFlow: new ParticleFlowScheduler(GROUND_FIRE_TONGUE_FREQUENCY_MS),
      sparkFlow: new ParticleFlowScheduler(GROUND_FIRE_SPARK_FREQUENCY_MS),
      smokeFlow: new ParticleFlowScheduler(GROUND_FIRE_SMOKE_FREQUENCY_MS),
      nodes: [],
    };
  }

  private applyLayout(cluster: GroundFireCluster, layout: GroundFireClusterLayout): void {
    const oldLayoutSignature = cluster.layoutSignature;
    cluster.cells = layout.cells;
    cluster.layoutSignature = layout.layoutSignature;
    cluster.centerX = layout.centerX;
    cluster.centerY = layout.centerY;
    cluster.widthPx = layout.widthPx;
    cluster.heightPx = layout.heightPx;
    cluster.totalIntensity = layout.totalIntensity;
    cluster.maxIntensity = layout.maxIntensity;
    cluster.expiresAt = layout.expiresAt;

    const nextBillowCount = this.getBillowCount(cluster);
    const nextTongueCount = this.getTongueCount(cluster);
    const nextHeatBodyCount = this.getHeatBodyCount(cluster);
    const nextSparkCount = this.getSparkCount(cluster);
    const shapeChanged = oldLayoutSignature !== layout.layoutSignature
      || cluster.billowCount !== nextBillowCount
      || cluster.tongueCount !== nextTongueCount
      || cluster.heatBodyCount !== nextHeatBodyCount
      || cluster.sparkCount !== nextSparkCount;

    cluster.billowCount = nextBillowCount;
    cluster.tongueCount = nextTongueCount;
    cluster.heatBodyCount = nextHeatBodyCount;
    cluster.sparkCount = nextSparkCount;
    if (shapeChanged) this.rebuildNodes(cluster);
  }

  private rebuildNodes(cluster: GroundFireCluster): void {
    const targetCount = cluster.billowCount + cluster.tongueCount;
    for (let index = 0; index < targetCount; index += 1) {
      const role = index < cluster.billowCount ? 'billow' : 'tongue';
      const roleIndex = role === 'billow' ? index : index - cluster.billowCount;
      const cellIndex = this.pickCellIndex(cluster, roleIndex, role === 'tongue');
      const cell = cluster.cells[cellIndex];
      const cellX = (cell.gridX + 0.5) * GROUND_FIRE_CELL_SIZE;
      const cellY = (cell.gridY + 0.5) * GROUND_FIRE_CELL_SIZE;
      const localSeed = this.hashPosition(cellX, cellY) ^ Math.imul(cluster.seed, index + 11);
      const distance = Math.hypot(cellX - cluster.centerX, cellY - cluster.centerY);
      const radius = Math.max(GROUND_FIRE_CELL_SIZE, Math.max(cluster.widthPx, cluster.heightPx) * 0.58);
      const heat = Phaser.Math.Clamp(1 - distance / radius, 0, 1);
      const node: GroundFireNode = cluster.nodes[index] ?? {
        role,
        x: cellX,
        y: cellY,
        heat,
        size: 1,
        phase: 0,
        rotation: 0,
        angularVelocity: 0,
        driftX: 0,
        driftY: 0,
        seed: localSeed,
      };
      node.role = role;
      node.seed = localSeed;
      node.heat = Phaser.Math.Clamp(heat + (role === 'tongue' ? 0.18 : 0), 0, 1);
      node.size = role === 'billow'
        ? 0.9 + this.seededUnit(localSeed, 23) * 0.34
        : 0.72 + this.seededUnit(localSeed, 29) * 0.24;
      node.phase = this.seededUnit(localSeed, 31) * TWO_PI;
      node.rotation = this.seededUnit(localSeed, 37) * TWO_PI;
      node.angularVelocity = (this.seededUnit(localSeed, 41) - 0.5) * (role === 'billow' ? 0.9 : 1.25);
      node.driftX = (this.seededUnit(localSeed, 43) - 0.5) * (role === 'billow' ? 7 : 11);
      node.driftY = (this.seededUnit(localSeed, 47) - 0.5) * (role === 'billow' ? 7 : 11);
      if (role === 'tongue') {
        // Tongues stay central and hot; they are not a directional jet.
        node.x = Phaser.Math.Linear(cellX, cluster.centerX, 0.68);
        node.y = Phaser.Math.Linear(cellY, cluster.centerY, 0.68);
      } else {
        node.x = cellX;
        node.y = cellY;
      }
      cluster.nodes[index] = node;
    }
    cluster.nodes.length = targetCount;
  }

  private emit(deltaMs: number, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    const bodyFrequency = system.quality.scaleFrequency(
      GROUND_FIRE_HEAT_BODY_FREQUENCY_MS,
      GpuVfxEffectId.GroundFireHeatBody,
    );
    const billowFrequency = system.quality.scaleFrequency(
      GROUND_FIRE_BILLOW_FREQUENCY_MS,
      GpuVfxEffectId.GroundFireOuter,
    );
    const tongueFrequency = system.quality.scaleFrequency(
      GROUND_FIRE_TONGUE_FREQUENCY_MS,
      GpuVfxEffectId.GroundFireCore,
    );
    const sparkFrequency = system.quality.scaleFrequency(
      GROUND_FIRE_SPARK_FREQUENCY_MS,
      GpuVfxEffectId.GroundFireSpark,
    );
    const smokeFrequency = system.quality.scaleFrequency(
      GROUND_FIRE_SMOKE_FREQUENCY_MS,
      GpuVfxEffectId.GroundFireSmoke,
    );

    for (const cluster of this.clusters.values()) {
      if (cluster.expiresAt <= this.synchronizedNow) continue;
      const age = this.clusterAge(cluster, nowMs);
      const intensity = this.clusterIntensity(cluster) * (0.98 - age * 0.12);
      const fade = Phaser.Math.Clamp((cluster.expiresAt - this.synchronizedNow) / GROUND_FIRE_FADE_MS, 0, 1);
      if (bodyFrequency > 0) {
        cluster.heatBodyFlow.setFrequency(bodyFrequency);
        const due = Math.min(3, cluster.heatBodyFlow.tick(deltaMs));
        for (let index = 0; index < due; index += 1) this.spawnHeatBody(cluster, intensity, fade, nowMs);
      } else {
        system.recordQualityDrop(GpuVfxEffectId.GroundFireHeatBody);
      }
      if (billowFrequency > 0) {
        cluster.billowFlow.setFrequency(billowFrequency);
        const due = Math.min(4, cluster.billowFlow.tick(deltaMs));
        for (let index = 0; index < due; index += 1) this.spawnBillow(cluster, intensity, fade, nowMs);
      } else {
        system.recordQualityDrop(GpuVfxEffectId.GroundFireOuter);
      }
      if (tongueFrequency > 0) {
        cluster.tongueFlow.setFrequency(tongueFrequency);
        const due = Math.min(3, cluster.tongueFlow.tick(deltaMs));
        for (let index = 0; index < due; index += 1) this.spawnTongue(cluster, intensity, fade, nowMs);
      } else {
        system.recordQualityDrop(GpuVfxEffectId.GroundFireCore);
      }
      if (sparkFrequency > 0) {
        cluster.sparkFlow.setFrequency(sparkFrequency);
        const due = Math.min(2, cluster.sparkFlow.tick(deltaMs));
        const sparkBurst = Math.min(2, cluster.sparkCount);
        for (let index = 0; index < due; index += 1) {
          for (let sparkIndex = 0; sparkIndex < sparkBurst; sparkIndex += 1) {
            this.spawnSpark(cluster, intensity, fade, nowMs);
          }
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.GroundFireSpark);
      }
      if (smokeFrequency > 0) {
        cluster.smokeFlow.setFrequency(smokeFrequency);
        if (cluster.smokeFlow.tick(deltaMs) > 0 && intensity > 0.5) {
          this.spawnSmoke(cluster, intensity, fade, nowMs);
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.GroundFireSmoke);
      }
    }
  }

  private spawnHeatBody(cluster: GroundFireCluster, intensity: number, fade: number, nowMs: number): void {
    const bodySpec = this.heatBodySpec;
    const system = this.gpuVfx;
    if (!bodySpec || !system || cluster.heatBodyCount <= 0) return;
    const slot = cluster.bodyCursor++ % cluster.heatBodyCount;
    const age = this.clusterAge(cluster, nowMs);
    const pulse = 1 + Math.sin(nowMs * 0.0021 + cluster.phase + slot * 1.7) * 0.075;
    const axisIsX = cluster.widthPx >= cluster.heightPx;
    const spread = Math.max(GROUND_FIRE_CELL_SIZE, Math.max(cluster.widthPx, cluster.heightPx) * 0.19);
    const offset = slot === 0 ? 0 : (slot === 1 ? -spread : spread);
    const x = cluster.centerX + (axisIsX ? offset : 0);
    const y = cluster.centerY + (axisIsX ? 0 : offset);
    const bodySize = Math.max(28, Math.max(cluster.widthPx, cluster.heightPx) * (0.82 + intensity * 0.12));
    const elongation = axisIsX
      ? Phaser.Math.Clamp(cluster.widthPx / Math.max(cluster.heightPx, GROUND_FIRE_CELL_SIZE), 1, 2.4)
      : Phaser.Math.Clamp(cluster.heightPx / Math.max(cluster.widthPx, GROUND_FIRE_CELL_SIZE), 1, 2.4);
    bodySpec.lifeMs = this.seededRange(cluster.seed, 53 + slot, GROUND_FIRE_BODY_LIFESPAN.min, GROUND_FIRE_BODY_LIFESPAN.max);
    bodySpec.x = x;
    bodySpec.y = y;
    bodySpec.vx = Math.sin(nowMs * 0.001 + cluster.phase + slot) * 1.4;
    bodySpec.vy = Math.cos(nowMs * 0.0013 + cluster.phase + slot) * 1.4;
    bodySpec.rotation = axisIsX ? 0 : Math.PI * 0.5;
    bodySpec.angularVelocity = Math.sin(cluster.phase + slot * 2.3) * 0.12;
    bodySpec.scaleStart = bodySize / 32 * 0.94 * pulse;
    bodySpec.scaleEnd = bodySpec.scaleStart * 1.08;
    bodySpec.stretchStart = elongation;
    bodySpec.stretchEnd = elongation * 0.94;
    bodySpec.alphaStart = (0.13 + intensity * 0.1) * fade;
    bodySpec.tint = this.pickHeatTint(cluster.visualStyle, 0.5 + intensity * 0.22 - age * 0.14, cluster.seed, 67 + slot);
    system.spawn(bodySpec, this.source, nowMs);
  }

  private spawnBillow(cluster: GroundFireCluster, intensity: number, fade: number, nowMs: number): void {
    const node = cluster.nodes[cluster.billowCursor++ % Math.max(1, cluster.billowCount)];
    if (!node || node.role !== 'billow') return;
    const wobbleX = Math.sin(nowMs * 0.0017 + node.phase) * 2.4;
    const wobbleY = Math.cos(nowMs * 0.00145 + node.phase * 1.31) * 2.1;
    const size = (GROUND_FIRE_CELL_SIZE * (1.15 + intensity * 0.32) * node.size) / 32;
    this.spawnBillowAt(
      node.x + wobbleX,
      node.y + wobbleY,
      size,
      node.heat,
      cluster.visualStyle,
      node.seed,
      nowMs,
      intensity,
      fade,
      node,
    );
  }

  private spawnTongue(cluster: GroundFireCluster, intensity: number, fade: number, nowMs: number): void {
    const tongueIndex = cluster.tongueCursor++ % Math.max(1, cluster.tongueCount);
    const node = cluster.nodes[cluster.billowCount + tongueIndex];
    if (!node || node.role !== 'tongue') return;
    const wobbleX = Math.sin(nowMs * 0.0024 + node.phase * 1.2) * 1.8;
    const wobbleY = Math.cos(nowMs * 0.002 + node.phase * 0.83) * 1.8;
    this.spawnTongueAt(
      node.x + wobbleX,
      node.y + wobbleY,
      (0.92 + intensity * 0.22) * node.size,
      node.heat,
      cluster.visualStyle,
      node.seed,
      nowMs,
      intensity,
      fade,
      node,
    );
  }

  private spawnSpark(cluster: GroundFireCluster, intensity: number, fade: number, nowMs: number): void {
    const nodeIndex = cluster.billowCount + (cluster.sparkCursor++ % Math.max(1, cluster.tongueCount));
    const node = cluster.nodes[nodeIndex];
    if (!node) return;
    this.spawnSparkAt(node.x, node.y, intensity * (0.72 + node.heat * 0.3), cluster.visualStyle, node.seed, nowMs, fade);
  }

  private spawnSmoke(cluster: GroundFireCluster, intensity: number, fade: number, nowMs: number): void {
    const spec = this.smokeSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    if (this.admitGroundBurst(GpuVfxEffectId.GroundFireSmoke, 1) <= 0) return;
    const seed = cluster.seed ^ cluster.bodyCursor;
    spec.lifeMs = this.seededRange(seed, 71, 950, 1650);
    spec.x = cluster.centerX;
    spec.y = cluster.centerY - 3;
    spec.vx = (this.seededUnit(seed, 73) - 0.5) * 12;
    spec.vy = -8 - this.seededUnit(seed, 79) * 14;
    spec.rotation = this.seededUnit(seed, 83) * TWO_PI;
    spec.alphaStart = 0.08 * intensity * fade;
    spec.tint = 0x75675d;
    system.spawn(spec, this.source, nowMs);
  }

  private spawnBillowAt(
    x: number,
    y: number,
    size: number,
    heat: number,
    style: GroundFireVisualStyle,
    seed: number,
    nowMs: number,
    intensity = 1,
    fade = 1,
    node?: GroundFireNode,
  ): void {
    const spec = this.billowSpec;
    const system = this.gpuVfx;
    if (!spec || !system || this.admitGroundBurst(GpuVfxEffectId.GroundFireOuter, 1) <= 0) return;
    const phase = node?.phase ?? this.seededUnit(seed, 89) * TWO_PI;
    spec.lifeMs = this.seededRange(seed, 97, GROUND_FIRE_BILLOW_LIFESPAN.min, GROUND_FIRE_BILLOW_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = (node?.driftX ?? 0) * 0.32 + Math.sin(phase) * 2;
    spec.vy = (node?.driftY ?? 0) * 0.32 + Math.cos(phase * 1.17) * 2;
    spec.rotation = (node?.rotation ?? phase) + Math.sin(nowMs * 0.0011 + phase) * 0.28;
    spec.angularVelocity = node?.angularVelocity ?? Math.sin(phase) * 0.6;
    spec.scaleStart = size * (0.92 + intensity * 0.08);
    spec.scaleEnd = spec.scaleStart * 1.16;
    spec.stretchStart = 1.08 + this.seededUnit(seed, 101) * 0.24;
    spec.stretchEnd = 1.02;
    spec.alphaStart = (0.38 + intensity * 0.12) * fade;
    spec.tint = this.pickHeatTint(style, heat, seed, 103);
    system.spawn(spec, this.source, nowMs);
  }

  private spawnTongueAt(
    x: number,
    y: number,
    size: number,
    heat: number,
    style: GroundFireVisualStyle,
    seed: number,
    nowMs: number,
    intensity = 1,
    fade = 1,
    node?: GroundFireNode,
  ): void {
    const spec = this.tongueSpec;
    const system = this.gpuVfx;
    if (!spec || !system || this.admitGroundBurst(GpuVfxEffectId.GroundFireCore, 1) <= 0) return;
    const phase = node?.phase ?? this.seededUnit(seed, 107) * TWO_PI;
    spec.lifeMs = this.seededRange(seed, 109, GROUND_FIRE_TONGUE_LIFESPAN.min, GROUND_FIRE_TONGUE_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = (node?.driftX ?? 0) * 0.42 + Math.cos(phase * 1.1) * 3.2;
    spec.vy = (node?.driftY ?? 0) * 0.42 + Math.sin(phase * 0.9) * 3.2;
    spec.rotation = (node?.rotation ?? phase) + Math.sin(nowMs * 0.002 + phase) * 0.34;
    spec.angularVelocity = node?.angularVelocity ?? Math.cos(phase) * 0.8;
    spec.scaleStart = size * (0.88 + intensity * 0.12);
    spec.scaleEnd = spec.scaleStart * 1.14;
    spec.stretchStart = 1.2 + this.seededUnit(seed, 113) * 0.28;
    spec.stretchEnd = 0.98;
    spec.alphaStart = (0.55 + intensity * 0.16) * fade;
    spec.tint = this.pickHeatTint(style, Math.max(heat, 0.48), seed, 127);
    system.spawn(spec, this.source, nowMs);
  }

  private spawnSparkAt(
    x: number,
    y: number,
    intensity: number,
    style: GroundFireVisualStyle,
    seed: number,
    nowMs: number,
    fade = 1,
  ): void {
    const spec = this.sparkSpec;
    const system = this.gpuVfx;
    if (!spec || !system || this.admitGroundBurst(GpuVfxEffectId.GroundFireSpark, 1) <= 0) return;
    const phase = this.seededUnit(seed, 131) * TWO_PI;
    spec.lifeMs = this.seededRange(seed, 137, GROUND_FIRE_SPARK_LIFESPAN.min, GROUND_FIRE_SPARK_LIFESPAN.max);
    spec.x = x + Math.cos(phase) * 3;
    spec.y = y + Math.sin(phase) * 3;
    spec.vx = Math.cos(phase) * (7 + intensity * 8);
    spec.vy = Math.sin(phase) * (7 + intensity * 8);
    spec.rotation = phase;
    spec.angularVelocity = (this.seededUnit(seed, 139) - 0.5) * 1.2;
    spec.alphaStart = Phaser.Math.Clamp(0.5 + intensity * 0.45, 0.35, 1) * fade;
    spec.tint = this.pickHeatTint(style, 0.55 + intensity * 0.2, seed, 149);
    system.spawn(spec, this.source, nowMs);
  }

  private syncLights(now: number): void {
    const lighting = this.lighting;
    if (!lighting) return;

    for (const [key, record] of this.lightRecords) {
      if (this.clusters.has(record.clusterId)) continue;
      lighting.releaseLight(`groundfire:${key}`);
      this.lightRecords.delete(key);
    }

    this.lightRanking.length = 0;
    for (const cluster of this.clusters.values()) {
      const remaining = cluster.expiresAt - now;
      if (remaining <= 0) continue;
      const fade = Phaser.Math.Clamp(remaining / GROUND_FIRE_FADE_MS, 0, 1);
      const lightCount = this.getLightCount(cluster);
      const majorAxis = Math.max(cluster.widthPx, cluster.heightPx);
      const offset = Math.max(GROUND_FIRE_CELL_SIZE, majorAxis * 0.22);
      for (let index = 0; index < lightCount; index += 1) {
        const key = `${cluster.id}:${index}`;
        let record = this.lightRecords.get(key);
        if (!record) {
          record = {
            key,
            clusterId: cluster.id,
            x: 0,
            y: 0,
            weight: 0,
            radiusPx: 0,
            intensity: 0,
            visualStyle: cluster.visualStyle,
          };
          this.lightRecords.set(key, record);
        }
        const axisIsX = cluster.widthPx >= cluster.heightPx;
        const localOffset = index === 0 ? 0 : (index === 1 ? -offset : offset);
        record.x = cluster.centerX + (axisIsX ? localOffset : 0);
        record.y = cluster.centerY + (axisIsX ? 0 : localOffset);
        const sizeBoost = Phaser.Math.Clamp(Math.sqrt(cluster.cells.length) * 0.16, 0, 1.45);
        record.weight = (0.42 + this.clusterIntensity(cluster) * 0.65 + sizeBoost) * fade
          * (index === 0 ? 1 : 0.82);
        record.radiusPx = GROUND_FIRE_LIGHT_BUCKET_SIZE * (1.25 + sizeBoost * 0.48);
        record.intensity = 0.48 + Math.min(record.weight, 1.8) * 0.26;
        record.visualStyle = cluster.visualStyle;
        this.lightRanking.push(record);
      }
    }

    this.lightRanking.sort((left, right) => right.weight - left.weight);
    if (this.lightRanking.length > MAX_GROUND_FIRE_LIGHTS) this.lightRanking.length = MAX_GROUND_FIRE_LIGHTS;
    const stale = this.activeLightKeys;
    for (const record of this.lightRanking) {
      lighting.setLight(
        `groundfire:${record.key}`,
        record.visualStyle === 'void' ? 'voidGroundFire' : 'groundFire',
        record.x,
        record.y,
        { radiusPx: record.radiusPx, intensity: record.intensity },
      );
      stale.delete(record.key);
    }
    for (const staleKey of stale) lighting.releaseLight(`groundfire:${staleKey}`);
    stale.clear();
    for (const record of this.lightRanking) stale.add(record.key);
  }

  private resetQualityCarry(): void {
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.GroundFireHeatBody);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.GroundFireOuter);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.GroundFireCore);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.GroundFireSpark);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.GroundFireSmoke);
  }

  private getBillowCount(cluster: GroundFireCluster): number {
    return Phaser.Math.Clamp(1 + Math.floor(Math.sqrt(cluster.cells.length) * 0.72), 1, MAX_BILLOWS_PER_CLUSTER);
  }

  private getTongueCount(cluster: GroundFireCluster): number {
    return Phaser.Math.Clamp(1 + Math.floor(Math.sqrt(cluster.cells.length) / 3), 1, MAX_TONGUES_PER_CLUSTER);
  }

  private getHeatBodyCount(cluster: GroundFireCluster): number {
    return Phaser.Math.Clamp(1 + Math.floor(Math.sqrt(cluster.cells.length) / 6), 1, MAX_HEAT_BODIES_PER_CLUSTER);
  }

  private getSparkCount(cluster: GroundFireCluster): number {
    return Phaser.Math.Clamp(1 + Math.floor(Math.sqrt(cluster.cells.length) / 8), 1, MAX_SPARKS_PER_CLUSTER);
  }

  private getLightCount(cluster: GroundFireCluster): number {
    return cluster.cells.length >= 18 ? 2 : 1;
  }

  private clusterIntensity(cluster: GroundFireCluster): number {
    return Phaser.Math.Clamp(
      Math.log2(cluster.totalIntensity + 1) / 3 + Math.min(0.25, cluster.maxIntensity * 0.05),
      0.28,
      1.2,
    );
  }

  private clusterAge(cluster: GroundFireCluster, nowMs: number): number {
    return Phaser.Math.Clamp((nowMs - cluster.bornAt) / 1800, 0, 1);
  }

  private pickCellIndex(cluster: GroundFireCluster, nodeIndex: number, central: boolean): number {
    if (central) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < cluster.cells.length; index += 1) {
        const cell = cluster.cells[index];
        const x = (cell.gridX + 0.5) * GROUND_FIRE_CELL_SIZE;
        const y = (cell.gridY + 0.5) * GROUND_FIRE_CELL_SIZE;
        const distance = Math.hypot(x - cluster.centerX, y - cluster.centerY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      return (bestIndex + nodeIndex) % cluster.cells.length;
    }
    return Math.floor(this.seededUnit(cluster.seed, 181 + nodeIndex * 13) * cluster.cells.length);
  }

  private pickHeatTint(style: GroundFireVisualStyle, heat: number, seed: number, salt: number): number {
    const palette = style === 'void'
      ? (heat > 0.62 ? VOID_JET_TINTS_HOT : heat > 0.28 ? VOID_JET_TINTS_MID : VOID_JET_TINTS_COOL)
      : (heat > 0.62 ? FLAME_JET_TINTS_HOT : heat > 0.28 ? FLAME_JET_TINTS_MID : FLAME_JET_TINTS_COOL);
    return palette[Math.floor(this.seededUnit(seed, salt) * palette.length)];
  }

  private seededRange(seed: number, salt: number, min: number, max: number): number {
    return min + this.seededUnit(seed, salt) * (max - min);
  }

  private seededUnit(seed: number, salt: number): number {
    const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  private hashPosition(x: number, y: number): number {
    return Math.imul(Math.round(x) * 73856093, 1) ^ Math.imul(Math.round(y) * 19349663, 1);
  }

  private admitGroundBurst(effect: GpuVfxEffectId, count: number): number {
    const system = this.gpuVfx;
    if (!system) return 0;
    const amount = system.quality.scaleBurst(effect, count);
    if (amount < count) system.recordQualityDrop(effect, count - amount);
    return amount;
  }
}
