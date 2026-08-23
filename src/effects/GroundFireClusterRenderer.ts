import * as Phaser from 'phaser';
import type { GroundFireVisualStyle, SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../types';
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
const CELL = GROUND_FIRE_CELL_SIZE;
const GROUND_FIRE_SURFACE_SIZE = 32;

const GROUND_FIRE_TINTS_HOT = [0xffffc15a, 0xffff9e22, 0xffff7b0b, 0xffff5b05] as const;
const GROUND_FIRE_TINTS_MID = [0xffff7b0b, 0xfff44905, 0xffdd2105, 0xffc41504] as const;
const GROUND_FIRE_TINTS_COOL = [0xffbc1707, 0xff971006, 0xff760806, 0xff560306] as const;
const GROUND_FIRE_VOID_TINTS_HOT = [0xf2d3ff, 0xe6b6ff, 0xd79bff, 0xc98cff] as const;
const GROUND_FIRE_VOID_TINTS_MID = [0xc76cff, 0xb14ef2, 0x9c37e4, 0xd486ff] as const;
const GROUND_FIRE_VOID_TINTS_COOL = [0x7620b8, 0x571590, 0x3c0f68, 0x6a1aa4] as const;

const GROUND_FIRE_BED_LIFESPAN = { min: 900, max: 1400 };
const GROUND_FIRE_BILLOW_LIFESPAN = { min: 620, max: 1000 };
const GROUND_FIRE_TONGUE_LIFESPAN = { min: 380, max: 720 };
const GROUND_FIRE_SPARK_LIFESPAN = { min: 360, max: 720 };
const GROUND_FIRE_SMOKE_LIFESPAN = { min: 950, max: 1650 };
const GROUND_FIRE_FADE_MS = 450;

/**
 * Lebende Partikel *pro brennender Rasterzelle*, je Schicht.
 *
 * Die frueheren festen Node-Deckel (24 Billows, 12 Zungen, 4 Heat Bodies je Cluster) waren der
 * Grund, warum eine grosse Brandflaeche als Perlenkette las: die Emission wuchs mit `sqrt(Zellen)`
 * und die Deckung damit gegen null, waehrend jeder Node immer wieder dieselbe Stelle traf. Eine
 * Dichte je Zelle haelt die Deckung dagegen konstant – eine Flaeche sieht aus wie eine Flaeche,
 * ein einzelner Molotov wie vorher.
 *
 * Die Werte sind ein additives Helligkeitsbudget: Dichte x mittlere Alpha x Flaeche des Motivs.
 * Wer hier dreht, dreht die Helligkeit der Brandflaeche.
 */
const BED_DENSITY_PER_CELL = 0.58;
const BILLOW_DENSITY_PER_CELL = 0.95;
const TONGUE_DENSITY_PER_CELL = 0.42;
const SPARK_DENSITY_PER_CELL = 0.05;
/** Rauch bleibt ein sparsamer Accent; eigene Lane mit nur 128 Slots. */
const SMOKE_DENSITY_PER_CELL = 0.02;

/**
 * Bis hierhin geht jede Zelle voll in die Dichte ein; darueber nur noch zur Haelfte, gedeckelt
 * bei `GROUND_FIRE_MAX_EFFECTIVE_CELLS`. Eine arenagrosse Brandflaeche ist ohnehin groesser als
 * der Bildausschnitt – dort kostet volle Dichte Slots fuer Partikel, die niemand sieht.
 */
const GROUND_FIRE_FULL_DENSITY_CELLS = 140;
const GROUND_FIRE_MAX_EFFECTIVE_CELLS = 320;

/** Deckel je Frame und Flow, als Anteil der Ziel-Lebendzahl. Faengt Frame-Spikes ab. */
const GROUND_FIRE_FRAME_BURST_FRACTION = 0.3;
const GROUND_FIRE_MAX_FRAME_BURST = 48;

/**
 * Motivgroessen als Vielfaches der Rasterzelle. Ueber 1 gewaehlt, damit sich die Motive
 * benachbarter Zellen ueberlappen: erst die Ueberlappung macht aus Einzelpartikeln eine Flaeche.
 */
const BED_SIZE_CELLS = 2.55;
const BILLOW_SIZE_CELLS = 2.75;
const TONGUE_SIZE_CELLS = 2.05;

/** Geschwindigkeit des gemeinsamen Konvektionsfeldes in px/s. */
const BED_DRIFT_SPEED = 3;
const BILLOW_DRIFT_SPEED = 9;
const TONGUE_DRIFT_SPEED = 13;

/** Zellen bis zum Rand, ab denen eine Zelle als voll im Kern gilt. */
const CORE_DEPTH_CELLS = 2.2;

interface GroundFireCellField {
  /** Weltmittelpunkt der Rasterzelle. */
  x: number;
  y: number;
  /** 0 am Rand der Brandflaeche, 1 tief im Inneren. Traegt Temperatur und Zungenverteilung. */
  coreness: number;
  /** Auf `maxIntensity` normierte Zellintensitaet. */
  intensity: number;
  /** Netz-Uhr; laesst einzelne Zellen ausgehen, statt die ganze Flaeche gleichzeitig zu loeschen. */
  expiresAt: number;
  seed: number;
}

interface GroundFireCluster {
  id: string;
  seed: number;
  visualStyle: GroundFireVisualStyle;
  cells: readonly SyncedBurningGroundCell[];
  field: GroundFireCellField[];
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
  /** Gedaempfte Zellzahl; Basis aller Ziel-Lebendzahlen. */
  effectiveCells: number;
  /** Teilerfremd zur Feldlaenge: der Zellzeiger laeuft die Flaeche gleichmaessig ab. */
  stride: number;
  bedCursor: number;
  billowCursor: number;
  tongueCursor: number;
  sparkCursor: number;
  smokeCursor: number;
  bedFlow: ParticleFlowScheduler;
  billowFlow: ParticleFlowScheduler;
  tongueFlow: ParticleFlowScheduler;
  sparkFlow: ParticleFlowScheduler;
  smokeFlow: ParticleFlowScheduler;
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

/** Ergebnis des Konvektionsfeldes; wiederverwendet, damit der Hotpath nichts allokiert. */
const DRIFT = { x: 0, y: 0 };

/**
 * Cluster-only visual backend for persistent ground fire.
 *
 * It owns no Phaser GameObjects. A burning area is sampled as a *surface*: every spawn walks the
 * cell field with a coprime stride, so coverage follows the area instead of a handful of fixed
 * nodes, and three stacked layers build the fire from the ground up.
 *
 * ## Warum drei Schichten
 *
 * - **Glutbett** (`GroundFireHeatBody`): breite, langsame Grundhelligkeit.
 * - **Flaechenfeld** (`GroundFireOuter`): die organische, additive Grundmaske mit grosser
 *   Ueberlappung und ohne eigene Flammensilhouette.
 * - **Heissfeld** (`GroundFireCore`): dieselbe Maske mit kleinerer, variabler Dichte und hoeherer
 *   Temperatur; es setzt Glutnester, keine separaten Zungen.
 *
 * ## Warum die Bewegung ein Feld ist und kein Zufall je Partikel
 *
 * Richtung und Drehung kommen aus einem cluster-weiten, langsam wandernden Konvektionsfeld, das
 * nur von Ort und Zeit abhaengt. Benachbarte Partikel bekommen dadurch fast dieselbe Richtung und
 * die Flaeche bewegt sich als *ein* Feuer. Pro Partikel gewuerfelte Drift ergibt stattdessen ein
 * Flimmern, in dem jeder Partikel als eigenes Objekt sichtbar wird.
 *
 * Aus demselben Feld kommt die Temperatur: `coreness` legt den Grundverlauf (heisser Kern, kuehler
 * Rand), ein wanderndes Flackern hebt einzelne Stellen darueber hinaus an. Reales Feuer hat
 * wandernde heisse Zonen; ein statischer Verlauf vom Schwerpunkt nach aussen liest sich als Kreis.
 */
export class GroundFireClusterRenderer {
  private readonly clusters = new Map<string, GroundFireCluster>();
  private readonly lightRecords = new Map<string, GroundFireLightRecord>();
  private readonly activeLightKeys = new Set<string>();
  private readonly lightRanking: GroundFireLightRecord[] = [];
  private snapshotSignature = '';
  private gpuVfx: GpuVfxSystem | null = null;
  private bedSpec: GpuVfxSpawnSpec | null = null;
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

    const bed = system.createSpec(GpuVfxEffectId.GroundFireHeatBody);
    bed.frame = GpuVfxFrameId.FlameBed;
    bed.yMode = GpuVfxEase.Linear;
    bed.scaleEase = GpuVfxEase.QuadOut;
    bed.alphaEnd = 0;
    // Das Bett ist Glut, kein zuendendes Gas: es wird in seiner Farbe geboren und bleibt darin.
    bed.tintBlendStart = 1;
    bed.tintBlendEnd = 1;
    this.bedSpec = bed;

    const billow = system.createSpec(GpuVfxEffectId.GroundFireOuter);
    billow.frame = GpuVfxFrameId.FlameBed;
    billow.yMode = GpuVfxEase.Linear;
    billow.scaleEase = GpuVfxEase.QuadOut;
    billow.alphaEnd = 0;
    billow.tintBlendStart = 0.96;
    billow.tintBlendEnd = 1;
    this.billowSpec = billow;

    const tongue = system.createSpec(GpuVfxEffectId.GroundFireCore);
    tongue.frame = GpuVfxFrameId.FlameBed;
    tongue.yMode = GpuVfxEase.Linear;
    tongue.scaleEase = GpuVfxEase.QuadOut;
    tongue.alphaEnd = 0;
    tongue.tintBlendStart = 0.86;
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

    const layouts = buildGroundFireClusterLayouts(snapshot.cells, CELL);
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
    this.driftAt(x, y, nowMs, 0);
    const dirX = DRIFT.x;
    const dirY = DRIFT.y;
    this.spawnBedAt(x, y, 1, 0.34, visualStyle, seed, nowMs, dirX, dirY, 1);
    this.spawnBillowAt(x, y, BILLOW_SIZE_CELLS * CELL / GROUND_FIRE_SURFACE_SIZE, 0.7, visualStyle, seed, nowMs, dirX, dirY, 1);
    this.spawnBillowAt(
      x + 4, y - 2, BILLOW_SIZE_CELLS * CELL / GROUND_FIRE_SURFACE_SIZE * 0.82, 0.6, visualStyle, seed ^ 0x41, nowMs, dirX, dirY, 0.9,
    );
    this.spawnTongueAt(
      x,
      y,
      TONGUE_SIZE_CELLS * (0.72 + this.seededUnit(seed, 85) * 0.6),
      0.92,
      visualStyle,
      seed ^ 0x83,
      nowMs,
      dirX,
      dirY,
      1,
    );
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

  // ── Cluster-Aufbau ─────────────────────────────────────────────────────────

  private createCluster(layout: GroundFireClusterLayout): GroundFireCluster {
    return {
      id: layout.id,
      seed: layout.seed,
      visualStyle: layout.visualStyle,
      cells: layout.cells,
      field: [],
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
      effectiveCells: 1,
      stride: 1,
      bedCursor: 0,
      billowCursor: 0,
      tongueCursor: 0,
      sparkCursor: 0,
      smokeCursor: 0,
      bedFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_BED_LIFESPAN)),
      billowFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_BILLOW_LIFESPAN)),
      tongueFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_TONGUE_LIFESPAN)),
      sparkFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_SPARK_LIFESPAN)),
      smokeFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_SMOKE_LIFESPAN)),
    };
  }

  private applyLayout(cluster: GroundFireCluster, layout: GroundFireClusterLayout): void {
    const shapeChanged = cluster.layoutSignature !== layout.layoutSignature;
    cluster.cells = layout.cells;
    cluster.layoutSignature = layout.layoutSignature;
    cluster.centerX = layout.centerX;
    cluster.centerY = layout.centerY;
    cluster.widthPx = layout.widthPx;
    cluster.heightPx = layout.heightPx;
    cluster.totalIntensity = layout.totalIntensity;
    cluster.maxIntensity = layout.maxIntensity;
    cluster.expiresAt = layout.expiresAt;
    cluster.effectiveCells = this.effectiveCellCount(layout.cells.length);

    // Die Ablaufzeiten wandern auch ohne Formaenderung weiter (eine nachgefuetterte Flaeche
    // behaelt ihre Zellen), deshalb wird das Feld immer aufgefrischt und nur die teure
    // Randdistanz an die Form gebunden.
    this.refreshFieldValues(cluster);
    if (shapeChanged || cluster.field.length !== layout.cells.length) {
      this.rebuildField(cluster);
      if (shapeChanged) this.primeClusterEmission(cluster);
    }
  }

  /** Neue Feuerflaechen muessen im ersten GPU-Tick lesbar sein, statt auf die erste
   * lebensdauerbasierte Flow-Periode zu warten. */
  private primeClusterEmission(cluster: GroundFireCluster): void {
    cluster.bedFlow.primeForImmediateEmission();
    cluster.billowFlow.primeForImmediateEmission();
    cluster.tongueFlow.primeForImmediateEmission();
    cluster.sparkFlow.primeForImmediateEmission();
    cluster.smokeFlow.primeForImmediateEmission();
  }

  /**
   * Baut das Zellfeld neu: Weltmittelpunkte, Randdistanz und der teilerfremde Schrittweite.
   *
   * Die Randdistanz ist eine Vielquellen-BFS von aussen nach innen. Sie ersetzt die frueher
   * benutzte Distanz zum Schwerpunkt: die machte aus jeder Form – auch aus einer langen
   * Flammenwerferspur – einen Kreis mit heisser Mitte und liess breite Flaechen aussen erkalten.
   */
  private rebuildField(cluster: GroundFireCluster): void {
    const cells = cluster.cells;
    const count = cells.length;
    const field = cluster.field;
    field.length = 0;

    const index = new Map<number, number>();
    for (let i = 0; i < count; i += 1) index.set(this.gridKey(cells[i].gridX, cells[i].gridY), i);

    const distance = new Int32Array(count);
    const queue = new Int32Array(count);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < count; i += 1) {
      const cell = cells[i];
      const open = !index.has(this.gridKey(cell.gridX + 1, cell.gridY))
        || !index.has(this.gridKey(cell.gridX - 1, cell.gridY))
        || !index.has(this.gridKey(cell.gridX, cell.gridY + 1))
        || !index.has(this.gridKey(cell.gridX, cell.gridY - 1));
      if (!open) continue;
      distance[i] = 1;
      queue[tail++] = i;
    }

    while (head < tail) {
      const current = queue[head++];
      const cell = cells[current];
      for (let n = 0; n < 4; n += 1) {
        const dx = n === 0 ? 1 : n === 1 ? -1 : 0;
        const dy = n === 2 ? 1 : n === 3 ? -1 : 0;
        const neighbour = index.get(this.gridKey(cell.gridX + dx, cell.gridY + dy));
        if (neighbour === undefined || distance[neighbour] !== 0) continue;
        distance[neighbour] = distance[current] + 1;
        queue[tail++] = neighbour;
      }
    }

    for (let i = 0; i < count; i += 1) {
      const cell = cells[i];
      const x = (cell.gridX + 0.5) * CELL;
      const y = (cell.gridY + 0.5) * CELL;
      field.push({
        x,
        y,
        // Eine vollstaendig eingeschlossene Flaeche ohne Randzelle kann es nicht geben; ein
        // `distance` von 0 waere trotzdem nur maximal kalt und nie ein Loch.
        coreness: Phaser.Math.Clamp((distance[i] - 1) / CORE_DEPTH_CELLS, 0, 1),
        intensity: 1,
        expiresAt: cell.expiresAt,
        seed: this.hashPosition(x, y) ^ Math.imul(cluster.seed, i + 11),
      });
    }

    cluster.stride = this.coprimeStride(count, cluster.seed);
    this.refreshFieldValues(cluster);
  }

  /** Intensitaet und Ablaufzeit je Zelle; billig genug fuer jeden Snapshot. */
  private refreshFieldValues(cluster: GroundFireCluster): void {
    const scale = 1 / Math.max(1, cluster.maxIntensity);
    for (let i = 0; i < cluster.field.length && i < cluster.cells.length; i += 1) {
      const cell = cluster.cells[i];
      cluster.field[i].intensity = Phaser.Math.Clamp(Math.max(1, cell.intensity) * scale, 0.35, 1);
      cluster.field[i].expiresAt = cell.expiresAt;
    }
  }

  // ── Emission ───────────────────────────────────────────────────────────────

  private emit(deltaMs: number, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    for (const cluster of this.clusters.values()) {
      if (cluster.expiresAt <= this.synchronizedNow || cluster.field.length === 0) continue;
      const age = this.clusterAge(cluster, nowMs);
      const intensity = this.clusterIntensity(cluster) * (0.98 - age * 0.12);

      this.runFlow(
        cluster, cluster.bedFlow, deltaMs, GROUND_FIRE_BED_LIFESPAN, BED_DENSITY_PER_CELL,
        GpuVfxEffectId.GroundFireHeatBody, intensity, nowMs, this.spawnBed,
      );
      this.runFlow(
        cluster, cluster.billowFlow, deltaMs, GROUND_FIRE_BILLOW_LIFESPAN, BILLOW_DENSITY_PER_CELL,
        GpuVfxEffectId.GroundFireOuter, intensity, nowMs, this.spawnBillow,
      );
      this.runFlow(
        cluster, cluster.tongueFlow, deltaMs, GROUND_FIRE_TONGUE_LIFESPAN, TONGUE_DENSITY_PER_CELL,
        GpuVfxEffectId.GroundFireCore, intensity, nowMs, this.spawnTongue,
      );
      this.runFlow(
        cluster, cluster.sparkFlow, deltaMs, GROUND_FIRE_SPARK_LIFESPAN, SPARK_DENSITY_PER_CELL,
        GpuVfxEffectId.GroundFireSpark, intensity, nowMs, this.spawnClusterSpark,
      );
      if (intensity > 0.5) {
        this.runFlow(
          cluster, cluster.smokeFlow, deltaMs, GROUND_FIRE_SMOKE_LIFESPAN, SMOKE_DENSITY_PER_CELL,
          GpuVfxEffectId.GroundFireSmoke, intensity, nowMs, this.spawnSmoke,
        );
      }
    }
  }

  /**
   * Ein Flow eines Clusters: aus Ziel-Lebendzahl und Lebensdauer wird die Frequenz, aus der
   * Frequenz die Zahl faelliger Spawns.
   *
   * `lebend = Rate x Lebensdauer`, also `Frequenz = Lebensdauer / lebend`. Die Dichte steht damit
   * direkt in der Emission statt als indirekt eingestellter Burst-Zaehler, und der
   * Qualitaetsfaktor greift wie bei jedem anderen Flow ueber `scaleFrequency`.
   */
  private runFlow(
    cluster: GroundFireCluster,
    flow: ParticleFlowScheduler,
    deltaMs: number,
    lifespan: { min: number; max: number },
    densityPerCell: number,
    effect: GpuVfxEffectId,
    intensity: number,
    nowMs: number,
    spawn: (this: GroundFireClusterRenderer, cluster: GroundFireCluster, intensity: number, nowMs: number) => void,
  ): void {
    const system = this.gpuVfx;
    if (!system) return;

    const targetLive = Math.max(1, cluster.effectiveCells * densityPerCell);
    const frequency = system.quality.scaleFrequency(this.averageLife(lifespan) / targetLive, effect);
    if (frequency <= 0) {
      system.recordQualityDrop(effect);
      return;
    }

    flow.setFrequency(frequency);
    const cap = Phaser.Math.Clamp(
      Math.ceil(targetLive * GROUND_FIRE_FRAME_BURST_FRACTION),
      1,
      GROUND_FIRE_MAX_FRAME_BURST,
    );
    const due = Math.min(cap, flow.tick(deltaMs));
    for (let n = 0; n < due; n += 1) spawn.call(this, cluster, intensity, nowMs);
  }

  private spawnBed(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const cell = this.pickCell(cluster, cluster.bedCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.bedCursor, -1640531527);
    this.driftAt(cell.x, cell.y, nowMs, cluster.phase);
    const dirX = DRIFT.x;
    const dirY = DRIFT.y;
    // Etwas ueber die Zelle hinaus gestreut: eine exakt auf die Zelle geklemmte Streuung zeichnet
    // das Raster nach, sobald die Flanken der Motive uebereinanderliegen.
    this.spawnBedAt(
      cell.x + (this.seededUnit(seed, 53) - 0.5) * CELL * 1.25,
      cell.y + (this.seededUnit(seed, 59) - 0.5) * CELL * 1.25,
      0.86 + this.seededUnit(seed, 61) * 0.3,
      this.heatAt(cluster, cell, nowMs, intensity) * 0.72,
      cluster.visualStyle,
      seed,
      nowMs,
      dirX,
      dirY,
      fade * cell.intensity,
    );
  }

  private spawnBillow(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const cell = this.pickCell(cluster, cluster.billowCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.billowCursor, -1640531527);
    this.driftAt(cell.x, cell.y, nowMs, cluster.phase);
    const dirX = DRIFT.x;
    const dirY = DRIFT.y;
    const size = BILLOW_SIZE_CELLS * CELL * (0.86 + this.seededUnit(seed, 23) * 0.3)
      * (0.94 + intensity * 0.08) / GROUND_FIRE_SURFACE_SIZE;
    this.spawnBillowAt(
      cell.x + (this.seededUnit(seed, 67) - 0.5) * CELL,
      cell.y + (this.seededUnit(seed, 71) - 0.5) * CELL,
      size,
      this.heatAt(cluster, cell, nowMs, intensity),
      cluster.visualStyle,
      seed,
      nowMs,
      dirX,
      dirY,
      fade * cell.intensity,
    );
  }

  private spawnTongue(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    // Turnier aus zwei Kandidaten: die heissere Zelle gewinnt. Das schiebt die Zungen ins Innere,
    // ohne den Rand ganz auszuschliessen – ein reiner Kernfilter liesse die Raender flammenlos.
    const first = this.pickCell(cluster, cluster.tongueCursor++);
    const second = this.pickCell(cluster, cluster.tongueCursor + 7);
    if (!first) return;
    const cell = second && second.coreness > first.coreness ? second : first;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.tongueCursor, -2048144789);
    this.driftAt(cell.x, cell.y, nowMs, cluster.phase);
    const dirX = DRIFT.x;
    const dirY = DRIFT.y;
    this.spawnTongueAt(
      cell.x + (this.seededUnit(seed, 73) - 0.5) * CELL * 0.8,
      cell.y + (this.seededUnit(seed, 79) - 0.5) * CELL * 0.8,
      TONGUE_SIZE_CELLS * (0.58 + this.seededUnit(seed, 83) * 0.92) * (0.84 + intensity * 0.24),
      Math.max(0.42, this.heatAt(cluster, cell, nowMs, intensity) + 0.12),
      cluster.visualStyle,
      seed,
      nowMs,
      dirX,
      dirY,
      fade * cell.intensity,
    );
  }

  private spawnClusterSpark(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const cell = this.pickCell(cluster, cluster.sparkCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.sparkCursor, -1028477387);
    this.spawnSparkAt(cell.x, cell.y, intensity * (0.72 + cell.coreness * 0.3), cluster.visualStyle, seed, nowMs, fade);
  }

  private spawnSmoke(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const spec = this.smokeSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    const cell = this.pickCell(cluster, cluster.smokeCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.smokeCursor, 0x9e3779b1);
    spec.lifeMs = this.seededRange(seed, 71, GROUND_FIRE_SMOKE_LIFESPAN.min, GROUND_FIRE_SMOKE_LIFESPAN.max);
    spec.x = cell.x + (this.seededUnit(seed, 89) - 0.5) * CELL;
    spec.y = cell.y - 3;
    spec.vx = (this.seededUnit(seed, 73) - 0.5) * 12;
    spec.vy = -8 - this.seededUnit(seed, 79) * 14;
    spec.rotation = this.seededUnit(seed, 83) * TWO_PI;
    spec.alphaStart = 0.08 * intensity * fade;
    spec.tint = 0x75675d;
    system.spawn(spec, this.source, nowMs);
  }

  // ── Einzelne Spawns ────────────────────────────────────────────────────────

  private spawnBedAt(
    x: number,
    y: number,
    size: number,
    heat: number,
    style: GroundFireVisualStyle,
    seed: number,
    nowMs: number,
    dirX: number,
    dirY: number,
    fade: number,
  ): void {
    const spec = this.bedSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    spec.lifeMs = this.seededRange(seed, 97, GROUND_FIRE_BED_LIFESPAN.min, GROUND_FIRE_BED_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = dirX * BED_DRIFT_SPEED;
    spec.vy = dirY * BED_DRIFT_SPEED;
    spec.rotation = this.seededUnit(seed, 95) * TWO_PI;
    spec.angularVelocity = (this.seededUnit(seed, 96) - 0.5) * 0.24;
    spec.scaleStart = BED_SIZE_CELLS * CELL * size / GROUND_FIRE_SURFACE_SIZE;
    // Die Glut breitet sich kaum aus; ein wachsendes Bett wuerde ueber die Brandflaeche
    // hinauslaufen und ihre Kante ausfransen.
    spec.scaleEnd = spec.scaleStart * 1.05;
    spec.stretchStart = 0.92 + this.seededUnit(seed, 98) * 0.32;
    spec.stretchEnd = 0.96;
    spec.alphaStart = 0.18 * fade;
    spec.tint = this.pickHeatTint(style, heat, seed, 103);
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
    dirX: number,
    dirY: number,
    fade: number,
  ): void {
    const spec = this.billowSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    spec.lifeMs = this.seededRange(seed, 101, GROUND_FIRE_BILLOW_LIFESPAN.min, GROUND_FIRE_BILLOW_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = dirX * BILLOW_DRIFT_SPEED;
    spec.vy = dirY * BILLOW_DRIFT_SPEED;
    // Die Flaechenmaske ist rotationssymmetrisch genug fuer ein freies Drehen; dadurch entstehen
    // keine wiedererkennbaren, gleich ausgerichteten Einzelmotive im Raster.
    spec.rotation = this.seededUnit(seed, 99) * TWO_PI;
    spec.angularVelocity = (this.seededUnit(seed, 100) - 0.5) * 0.42;
    spec.scaleStart = size;
    spec.scaleEnd = spec.scaleStart * (1.08 + this.seededUnit(seed, 102) * 0.22);
    spec.stretchStart = 0.9 + this.seededUnit(seed, 105) * 0.48;
    spec.stretchEnd = 0.96 + this.seededUnit(seed, 106) * 0.18;
    spec.alphaStart = 0.28 * fade;
    spec.tint = this.pickHeatTint(style, heat, seed, 107);
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
    dirX: number,
    dirY: number,
    fade: number,
  ): void {
    const spec = this.tongueSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    spec.lifeMs = this.seededRange(seed, 109, GROUND_FIRE_TONGUE_LIFESPAN.min, GROUND_FIRE_TONGUE_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = dirX * TONGUE_DRIFT_SPEED;
    spec.vy = dirY * TONGUE_DRIFT_SPEED;
    spec.rotation = this.seededUnit(seed, 111) * TWO_PI;
    spec.angularVelocity = (this.seededUnit(seed, 112) - 0.5) * 0.7;
    spec.scaleStart = size * CELL / GROUND_FIRE_SURFACE_SIZE;
    spec.scaleEnd = spec.scaleStart * (1.04 + this.seededUnit(seed, 114) * 0.22);
    spec.stretchStart = 0.84 + this.seededUnit(seed, 113) * 0.72;
    spec.stretchEnd = 0.94 + this.seededUnit(seed, 115) * 0.22;
    spec.alphaStart = 0.34 * fade;
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
    if (!spec || !system) return;
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

  // ── Felder ─────────────────────────────────────────────────────────────────

  /**
   * Konvektionsfeld: normierte Stroemungsrichtung an einem Ort. Rein aus Ort und Zeit, damit
   * benachbarte Partikel dieselbe Richtung bekommen und die Flaeche als ein Feuer stroemt.
   *
   * Die zwei Wellenlaengen (rund 300 px und rund 110 px) ergeben zusammen eine grosse wandernde
   * Stroemung mit kleineren Wirbeln darin.
   */
  private driftAt(x: number, y: number, nowMs: number, phase: number): void {
    const slow = x * 0.021 + y * 0.017 + nowMs * 0.00042 + phase;
    const fast = y * 0.057 - x * 0.041 - nowMs * 0.00071 + phase * 1.7;
    const dx = Math.cos(slow) + Math.sin(fast) * 0.55;
    const dy = Math.sin(slow) + Math.cos(fast) * 0.55;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) {
      DRIFT.x = 1;
      DRIFT.y = 0;
      return;
    }
    DRIFT.x = dx / length;
    DRIFT.y = dy / length;
  }

  /**
   * Temperatur einer Zelle: Grundverlauf ueber die Randdistanz plus eine wandernde Flackerwelle.
   * Die Welle laeuft langsamer als der Partikelstrom, damit heisse Zonen sichtbar *wandern*,
   * statt als Rauschen zu flimmern.
   */
  private heatAt(cluster: GroundFireCluster, cell: GroundFireCellField, nowMs: number, intensity: number): number {
    const flicker = 0.5 + 0.5 * Math.sin(cell.x * 0.043 + cell.y * 0.037 + nowMs * 0.0026 + cluster.phase);
    return Phaser.Math.Clamp(
      0.2 + cell.coreness * 0.34 + flicker * 0.24 + intensity * 0.12,
      0,
      1,
    );
  }

  /** Restliche Brenndauer *dieser Zelle*; laesst eine Flaeche von aussen zurueckweichen. */
  private cellFade(cell: GroundFireCellField): number {
    return Phaser.Math.Clamp((cell.expiresAt - this.synchronizedNow) / GROUND_FIRE_FADE_MS, 0, 1);
  }

  /**
   * Die naechste Zelle des gleichmaessigen Rundlaufs. Weil `stride` teilerfremd zur Feldlaenge
   * ist, trifft der Zeiger jede Zelle genau einmal, bevor er sich wiederholt – die Deckung ist
   * damit auch ueber kurze Zeitfenster gleichmaessig statt zufaellig geklumpt.
   */
  private pickCell(cluster: GroundFireCluster, cursor: number): GroundFireCellField | null {
    const count = cluster.field.length;
    if (count === 0) return null;
    return cluster.field[(cursor * cluster.stride) % count];
  }

  private coprimeStride(count: number, seed: number): number {
    if (count <= 2) return 1;
    // Vom goldenen Schnitt aus nach oben suchen: der erste teilerfremde Schritt liegt bei jeder
    // Zellzahl nach wenigen Versuchen und verteilt die Treffer maximal ungleichfoermig im Raster.
    let stride = Math.max(1, Math.floor(count * 0.618) + (this.seededUnit(seed, 151) * 5 | 0));
    for (let attempt = 0; attempt < count; attempt += 1) {
      if (this.greatestCommonDivisor(stride, count) === 1) return stride;
      stride = stride % count + 1;
    }
    return 1;
  }

  private greatestCommonDivisor(a: number, b: number): number {
    let left = a;
    let right = b;
    while (right !== 0) {
      const next = left % right;
      left = right;
      right = next;
    }
    return left;
  }

  private effectiveCellCount(count: number): number {
    if (count <= GROUND_FIRE_FULL_DENSITY_CELLS) return count;
    return Math.min(
      GROUND_FIRE_MAX_EFFECTIVE_CELLS,
      GROUND_FIRE_FULL_DENSITY_CELLS + (count - GROUND_FIRE_FULL_DENSITY_CELLS) * 0.5,
    );
  }

  private averageLife(lifespan: { min: number; max: number }): number {
    return (lifespan.min + lifespan.max) * 0.5;
  }

  // ── Licht ──────────────────────────────────────────────────────────────────

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
      const offset = Math.max(CELL, majorAxis * 0.22);
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

  private pickHeatTint(style: GroundFireVisualStyle, heat: number, seed: number, salt: number): number {
    const palette = style === 'void'
      ? (heat > 0.62 ? GROUND_FIRE_VOID_TINTS_HOT : heat > 0.28 ? GROUND_FIRE_VOID_TINTS_MID : GROUND_FIRE_VOID_TINTS_COOL)
      : (heat > 0.62 ? GROUND_FIRE_TINTS_HOT : heat > 0.28 ? GROUND_FIRE_TINTS_MID : GROUND_FIRE_TINTS_COOL);
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

  private gridKey(gridX: number, gridY: number): number {
    // 16 Bit je Achse mit Vorzeichenversatz; Arenakoordinaten liegen weit innerhalb dieser Spanne.
    return ((gridX + 32768) << 16) | (gridY + 32768);
  }
}
