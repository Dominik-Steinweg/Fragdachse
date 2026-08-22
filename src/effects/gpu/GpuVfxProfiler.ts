import { GPU_VFX_EFFECTS } from './GpuVfxEffects';
import { GPU_VFX_LANES } from './GpuVfxRenderLanes';
import type { GpuVfxEffectId } from './GpuVfxEffects';
import type { GpuVfxPoolStats } from './GpuVfxPool';

/**
 * GpuVfxProfiler – Diagnose auf zwei Ebenen.
 *
 * Sobald mehrere logische Effekte einen physischen Layer teilen, reicht eine Statistik pro
 * Layername nicht mehr: "die Lane ist voll" beantwortet nicht, *wer* sie fuellt. Deshalb zaehlt
 * der Profiler beides – physische Lanes (Kapazitaet, Hoechststand, Uploads, Sichtbarkeit) und
 * logische Effekte (Versuche, Spawns, Quality- und Kapazitaets-Verwuerfe).
 *
 * Im Hotpath laufen ausschliesslich Indexzugriffe auf TypedArrays; Namen entstehen erst beim
 * Report.
 *
 * ## coVisibleFrames
 *
 * `visibleFrames` allein sagt nicht, ob zwei Lanes zusammengelegt werden duerfen: zwei Lanes
 * koennen gleich oft aktiv sein und trotzdem nie gleichzeitig. Gezaehlt wird deshalb pro Frame
 * die paarweise Ueberschneidung. Eine zusammengelegte Lane wird gezeichnet, sobald *irgendein*
 * Mitbewohner lebt – ohne hohe Ueberschneidung zahlt ein selten aktiver Effekt die Kapazitaet
 * aller anderen.
 */

export interface GpuVfxLaneReport {
  readonly id: number;
  readonly label: string;
  readonly capacity: number;
  readonly active: number;
  readonly highWaterMark: number;
  readonly rearms: number;
  readonly retirements: number;
  readonly capacityDrops: number;
  /** Hoechststand relativ zur Kapazitaet, auf drei Nachkommastellen. */
  readonly utilization: number;
  readonly visibleFrames: number;
  readonly segmentsTouched: number;
  readonly fullUploadFrames: number;
}

export interface GpuVfxEffectReport {
  readonly id: number;
  readonly label: string;
  readonly laneLabel: string;
  readonly spawnAttempts: number;
  readonly spawns: number;
  readonly qualityDrops: number;
  readonly capacityDrops: number;
}

export interface GpuVfxReport {
  readonly frames: number;
  readonly lanes: readonly GpuVfxLaneReport[];
  readonly effects: readonly GpuVfxEffectReport[];
  /**
   * Symmetrische Matrix: wie viele Frames zwei Lanes gleichzeitig aktiv waren. Diagonale =
   * `visibleFrames`.
   */
  readonly coVisibleFrames: readonly (readonly number[])[];
}

export interface GpuVfxCompanionCounters {
  readonly epoch: number;
  readonly frames: number;
  readonly spawns: number;
  readonly capacityDrops: number;
}

export class GpuVfxProfiler {
  private readonly laneCount = GPU_VFX_LANES.length;
  private readonly visibleFrames  = new Int32Array(GPU_VFX_LANES.length);
  private readonly coVisible      = new Int32Array(GPU_VFX_LANES.length * GPU_VFX_LANES.length);
  private readonly attempts       = new Int32Array(GPU_VFX_EFFECTS.length);
  private readonly spawns         = new Int32Array(GPU_VFX_EFFECTS.length);
  private readonly qualityDrops   = new Int32Array(GPU_VFX_EFFECTS.length);
  private readonly capacityDrops  = new Int32Array(GPU_VFX_EFFECTS.length);
  private frames = 0;
  private epoch = 0;

  recordAttempt(effect: GpuVfxEffectId): void {
    this.attempts[effect] += 1;
  }

  recordSpawn(effect: GpuVfxEffectId): void {
    this.spawns[effect] += 1;
  }

  recordQualityDrop(effect: GpuVfxEffectId): void {
    this.qualityDrops[effect] += 1;
  }

  recordCapacityDrop(effect: GpuVfxEffectId): void {
    this.capacityDrops[effect] += 1;
  }

  /** `activeMask` traegt ein Bit je Lane mit mindestens einem lebenden Member. */
  recordFrame(activeMask: number): void {
    this.frames += 1;
    if (activeMask === 0) return;
    for (let a = 0; a < this.laneCount; a += 1) {
      if ((activeMask & (1 << a)) === 0) continue;
      this.visibleFrames[a] += 1;
      for (let b = a; b < this.laneCount; b += 1) {
        if ((activeMask & (1 << b)) === 0) continue;
        this.coVisible[a * this.laneCount + b] += 1;
        if (b !== a) this.coVisible[b * this.laneCount + a] += 1;
      }
    }
  }

  /** Cumulative counters for the low-cost Companion interval collector. */
  getCompanionCounters(): GpuVfxCompanionCounters {
    let spawns = 0;
    let capacityDrops = 0;
    for (let index = 0; index < this.spawns.length; index += 1) {
      spawns += this.spawns[index];
      capacityDrops += this.capacityDrops[index];
    }
    return { epoch: this.epoch, frames: this.frames, spawns, capacityDrops };
  }

  buildReport(laneStats: readonly GpuVfxPoolStats[]): GpuVfxReport {
    const lanes: GpuVfxLaneReport[] = [];
    for (let id = 0; id < this.laneCount; id += 1) {
      const spec = GPU_VFX_LANES[id];
      const stats = laneStats[id];
      if (!stats) continue;
      lanes.push({
        id,
        label:            spec.label,
        capacity:         stats.capacity,
        active:           stats.liveCount,
        highWaterMark:    stats.peakLive,
        rearms:           stats.rearms,
        retirements:      stats.retirements,
        capacityDrops:    stats.capacityDrops,
        utilization:      Math.round((stats.peakLive / stats.capacity) * 1000) / 1000,
        visibleFrames:    this.visibleFrames[id],
        segmentsTouched:  stats.segmentsTouched,
        fullUploadFrames: stats.fullUploadFrames,
      });
    }

    const effects: GpuVfxEffectReport[] = GPU_VFX_EFFECTS.map((effect) => ({
      id:            effect.id,
      label:         effect.label,
      laneLabel:     GPU_VFX_LANES[effect.lane].label,
      spawnAttempts: this.attempts[effect.id],
      spawns:        this.spawns[effect.id],
      qualityDrops:  this.qualityDrops[effect.id],
      capacityDrops: this.capacityDrops[effect.id],
    }));

    const coVisibleFrames: number[][] = [];
    for (let a = 0; a < this.laneCount; a += 1) {
      const row: number[] = [];
      for (let b = 0; b < this.laneCount; b += 1) row.push(this.coVisible[a * this.laneCount + b]);
      coVisibleFrames.push(row);
    }

    return { frames: this.frames, lanes, effects, coVisibleFrames };
  }

  reset(): void {
    this.epoch += 1;
    this.visibleFrames.fill(0);
    this.coVisible.fill(0);
    this.attempts.fill(0);
    this.spawns.fill(0);
    this.qualityDrops.fill(0);
    this.capacityDrops.fill(0);
    this.frames = 0;
  }
}
