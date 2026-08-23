import * as Phaser from 'phaser';
import type { GroundFireVisualStyle, SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../types';
import {
  buildGroundFireClusterLayouts,
  groundFireCellsSignature,
  type GroundFireClusterLayout,
} from './GroundFireClusters';
import { GROUND_FIRE_CELL_SIZE } from './FireSystem';
import {
  GROUND_FIRE_BED_SIZE,
  GROUND_FIRE_SURFACE_SIZE,
} from './GroundFireTextures';
import {
  buildGroundFireTraversal,
  sampleGroundFireMotion,
  type GroundFireMotionSample,
} from './GroundFireMotionField';
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
const GROUND_FIRE_SURFACE_FRAMES: readonly GpuVfxFrameId[] = [
  GpuVfxFrameId.GroundFireSurface,
  GpuVfxFrameId.GroundFireSurfaceB,
  GpuVfxFrameId.GroundFireSurfaceC,
];
const GROUND_FIRE_BED_FRAMES: readonly GpuVfxFrameId[] = [
  GpuVfxFrameId.GroundFireBed,
  GpuVfxFrameId.GroundFireBedB,
];

/**
 * Temperaturbaender. Kein Band enthaelt reines Weiss: additiv summierte weisse Beitraege heben
 * alle drei Kanaele gemeinsam an, die Brandflaeche kippt dann als Ganzes ins Weisse, statt ihre
 * Farbe zu zeigen. Die Hitze traegt der Farbton, nicht die Entsaettigung.
 */
const GROUND_FIRE_TINTS_HOT  = [0xffc15a, 0xff9e22, 0xff7b0b, 0xff5b05] as const;
const GROUND_FIRE_TINTS_MID  = [0xff7b0b, 0xf44905, 0xdd2105, 0xc41504] as const;
const GROUND_FIRE_TINTS_COOL = [0xbc1707, 0x971006, 0x760806, 0x560306] as const;
/**
 * Nur fuer die Glutnester. Sie sind klein und ueberlappen kaum – hier darf der hellste Ton
 * stehen, ohne dass die Flaeche als Ganzes ausbleicht.
 */
const GROUND_FIRE_TINTS_EMBER = [0xffe6a4, 0xffd07a, 0xffb653, 0xff9a34] as const;
const GROUND_FIRE_VOID_TINTS_HOT  = [0xf2d3ff, 0xe6b6ff, 0xd79bff, 0xc98cff] as const;
const GROUND_FIRE_VOID_TINTS_MID  = [0xc76cff, 0xb14ef2, 0x9c37e4, 0xd486ff] as const;
const GROUND_FIRE_VOID_TINTS_COOL = [0x7620b8, 0x571590, 0x3c0f68, 0x6a1aa4] as const;
const GROUND_FIRE_VOID_TINTS_EMBER = [0xf7e2ff, 0xeac2ff, 0xdda4ff, 0xc887ff] as const;

/**
 * Lebensdauern. Bewusst lang: bei gleicher Ziel-Lebendzahl ist die Spawnrate `lebend /
 * Lebensdauer`, kurze Motive tauschen die Flaeche also staendig aus und lassen sie flimmern.
 * Ein Bodenfeuer *steht* – seine Bewegung kommt aus dem Konvektionsfeld, nicht aus dem
 * Erscheinen und Verschwinden einzelner Partikel.
 */
const GROUND_FIRE_BED_LIFESPAN   = { min: 1500, max: 1900 };
const GROUND_FIRE_FIELD_LIFESPAN = { min: 1250, max: 1750 };
const GROUND_FIRE_CORE_LIFESPAN  = { min: 900, max: 1350 };
const GROUND_FIRE_EMBER_LIFESPAN = { min: 700, max: 1100 };
const GROUND_FIRE_SPARK_LIFESPAN = { min: 650, max: 1100 };
const GROUND_FIRE_SPARK_ACCENT_LIFESPAN = { min: 1000, max: 1700 };
const GROUND_FIRE_SMOKE_LIFESPAN = { min: 1200, max: 1650 };
const GROUND_FIRE_FADE_MS = 450;

/**
 * Lebende Partikel *pro brennender Rasterzelle*, je Schicht.
 *
 * Die frueheren festen Node-Deckel je Cluster waren der Grund, warum eine grosse Brandflaeche als
 * Perlenkette las: die Emission wuchs mit `sqrt(Zellen)` und die Deckung damit gegen null. Eine
 * Dichte je Zelle haelt die Deckung konstant – eine Flaeche sieht aus wie eine Flaeche, ein
 * einzelner Molotov wie vorher.
 *
 * Die Werte sind ein additives Helligkeitsbudget: Dichte x mittlere Alpha x Flaeche des Motivs.
 * Wer hier dreht, dreht die Helligkeit der Brandflaeche.
 */
const BED_DENSITY_PER_CELL   = 0.70;
const FIELD_DENSITY_PER_CELL = 1.30;
const CORE_DENSITY_PER_CELL  = 0.85;
const EMBER_DENSITY_PER_CELL = 0.40;
export const GROUND_FIRE_SPARK_DENSITY_PER_CELL = 0.28;
export const GROUND_FIRE_SPARK_ACCENT_DENSITY_PER_CELL = 0.035;
/** Rauch bleibt ein sparsamer Accent; eigene Lane mit nur 128 Slots. */
const SMOKE_DENSITY_PER_CELL = 0.035;

/**
 * Untergrenzen je Cluster, unabhaengig von der Zellzahl.
 *
 * Ohne sie bekam eine *einzelne* brennende Rasterzelle genau ein Partikel je Schicht – sichtbar
 * war dann nur ein schwacher Glutfleck, kein Feuer.
 *
 * Die Werte sind keine Schaetzung: ein Motiv deckt mehr als eine Rasterzelle, ein Ein-Zell-Feuer
 * ist also so gross wie sein groesstes Motiv (2.7 Zellen Durchmesser, rund 5.7 Zellflaechen).
 * Damit es dieselbe *Flaechenhelligkeit* hat wie eine grosse Brandflaeche, braucht jede Schicht
 * `Dichte x 5.7 / Motivflaeche-in-Zellen` Partikel – beim Flaechenfeld `1.30 x 5.7 / 7.29 x 7.29`,
 * also rund 7. Die Rechnung steht bewusst hier: sie bindet die Untergrenzen an die Dichten, statt
 * sie unabhaengig driften zu lassen.
 */
const BED_MIN_LIVE   = 4;
const FIELD_MIN_LIVE = 7;
const CORE_MIN_LIVE  = 5;
const EMBER_MIN_LIVE = 2;
const SPARK_MIN_LIVE = 3;
const SPARK_ACCENT_MIN_LIVE = 1;
const SMOKE_MIN_LIVE = 1;

/**
 * Bis hierhin geht jede Zelle voll in die Dichte ein; darueber nur noch zur Haelfte, gedeckelt
 * bei `GROUND_FIRE_MAX_EFFECTIVE_CELLS`. Eine arenagrosse Brandflaeche ist ohnehin groesser als
 * der Bildausschnitt – dort kostet volle Dichte Slots fuer Partikel, die niemand sieht.
 */
const GROUND_FIRE_FULL_DENSITY_CELLS = 140;
export const GROUND_FIRE_MAX_EFFECTIVE_CELLS = 320;
export const GROUND_FIRE_DENSITY_BUDGET_PER_CELL = BED_DENSITY_PER_CELL
  + FIELD_DENSITY_PER_CELL
  + CORE_DENSITY_PER_CELL
  + EMBER_DENSITY_PER_CELL
  + GROUND_FIRE_SPARK_DENSITY_PER_CELL
  + GROUND_FIRE_SPARK_ACCENT_DENSITY_PER_CELL;

/** Deckel je Frame und Flow, als Anteil der Ziel-Lebendzahl. Faengt Frame-Spikes ab. */
const GROUND_FIRE_FRAME_BURST_FRACTION = 0.3;
const GROUND_FIRE_MAX_FRAME_BURST = 48;

/**
 * Motivgroessen als Vielfaches der Rasterzelle. Ueber 1 gewaehlt, damit sich die Motive
 * benachbarter Zellen ueberlappen: erst die Ueberlappung macht aus Einzelpartikeln eine Flaeche.
 * Sie haengen *nicht* an der Clustergroesse – ein kleines Feuer ist so gross wie sein Motiv, und
 * genau das war beim urspruenglichen Bodenfeuer schon richtig.
 */
const BED_SIZE_CELLS = 2.5;
const FIELD_SIZE_CELLS = 2.7;
const CORE_SIZE_CELLS = 1.9;
const EMBER_SIZE_CELLS = 1.0;

/**
 * Geschwindigkeit des gemeinsamen Konvektionsfeldes in px/s. Niedrig gehalten: sichtbar
 * wandernde Partikel machen die Flaeche hektisch, obwohl die Bewegung eines Bodenfeuers aus dem
 * langsamen Wandern der heissen Zonen kommen soll.
 */
const BED_DRIFT_SPEED = 0.75;
const FIELD_DRIFT_SPEED = 2;
const CORE_DRIFT_SPEED = 3.5;
const EMBER_DRIFT_SPEED = 1.5;

/**
 * Startalpha je Schicht – der Intensitaetsregler des Bodenfeuers.
 *
 * Der additive Mittelwert einer Schicht ueber die Brandflaeche ist
 * `Dichte x Motiv-Mittelalpha x Startalpha x 0.567 x Motivflaeche-in-Zellen`; der Faktor 0.567
 * ist das Integral aus linear ausblendender Alpha und wachsender Flaeche ueber die Lebenszeit.
 * Mit diesen Werten summieren sich die vier Schichten auf rund 0.97. Das urspruengliche
 * Bodenfeuer lag bei 0.56 – rechnerisch genau der Grund, warum es zu blass wirkte.
 */
const BED_ALPHA = 0.30;
const FIELD_ALPHA = 0.34;
const CORE_ALPHA = 0.52;
const EMBER_ALPHA = 0.85;

/** Zellen bis zum Rand, ab denen eine Zelle als voll im Kern gilt. */
const CORE_DEPTH_CELLS = 2.2;

/** Ab so vielen Zellen gilt ein Cluster als ausgedehnte Flaeche (siehe `GroundFireCluster.spread`). */
const GROUND_FIRE_SPREAD_CELLS = 5;

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
  /**
   * 0 bei einer einzelnen Zelle, 1 ab `GROUND_FIRE_SPREAD_CELLS`.
   *
   * Zwei Dinge haengen daran: die Streuung um die Zellmitte (ein Ein-Zell-Feuer darf nicht ueber
   * zweieinhalb Zellen spritzen) und die Untergrenze der `coreness` in `heatAt` – in einem
   * kleinen Cluster ist jede Zelle das Feuer und nicht sein kuehler Rand.
   */
  spread: number;
  /** Gedaempfte Zellzahl; Basis aller Ziel-Lebendzahlen. */
  effectiveCells: number;
  /** Unabhaengige, vollstaendige Permutationen verhindern Rasterlaeufe und Layer-Gleichlauf. */
  bedOrder: Int32Array;
  fieldOrder: Int32Array;
  coreOrder: Int32Array;
  emberOrder: Int32Array;
  sparkOrder: Int32Array;
  sparkAccentOrder: Int32Array;
  smokeOrder: Int32Array;
  bedCursor: number;
  fieldCursor: number;
  coreCursor: number;
  emberCursor: number;
  sparkCursor: number;
  sparkAccentCursor: number;
  smokeCursor: number;
  bedFlow: ParticleFlowScheduler;
  fieldFlow: ParticleFlowScheduler;
  coreFlow: ParticleFlowScheduler;
  emberFlow: ParticleFlowScheduler;
  sparkFlow: ParticleFlowScheduler;
  sparkAccentFlow: ParticleFlowScheduler;
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
const MOTION: GroundFireMotionSample = { x: 0, y: 0, heat: 0 };

/**
 * Cluster-only visual backend for persistent ground fire.
 *
 * It owns no Phaser GameObjects. A burning area is sampled as a *surface*: every visual layer
 * walks its own deterministic cell permutation, so coverage follows the area without a raster
 * sweep or synchronized layers. Four stacked surface layers build the fire from the ground up.
 *
 * ## Warum vier Schichten mit einer organischen Motivfamilie
 *
 * - **Glutbett** (`GroundFireHeatBody`, zwei breite Varianten): langsame Grundhelligkeit.
 * - **Flaechenfeld** (`GroundFireOuter`, drei organische Varianten): die additive Grundmaske mit
 *   grosser Ueberlappung und ohne wiederkehrende Kreis- oder Flammensilhouette.
 * - **Kern** (`GroundFireCore`, dieselben drei Varianten): kleiner, heisser und heller.
 * - **Glutnester** (`GroundFireEmber`, dieselben drei Varianten): kurzlebige helle Akzente.
 *
 * Die seed-deterministische Variantenwahl verbindet sich mit Rotation und Streckung. Dadurch
 * bleibt die gemeinsame weiche Formensprache erhalten, ohne dass einzelne Exemplare als
 * wiederholtes Muster lesbar werden.
 *
 * ## Warum die Bewegung ein Feld ist und kein Zufall je Partikel
 *
 * Richtung und Drehung kommen aus einem cluster-weiten, langsam morphenden Curl-Feld, das nur
 * von Ort und Zeit abhaengt. Benachbarte Partikel bekommen dadurch aehnliche lokale Richtungen,
 * ohne dass eine globale Welle ueber die Flaeche laeuft. Pro Partikel gewuerfelte Drift ergibt
 * stattdessen ein Flimmern, in dem jeder Partikel als eigenes Objekt sichtbar wird.
 *
 * Aus demselben Feld kommt die Temperatur: `coreness` legt den Grundverlauf (heisser Kern, kuehler
 * Rand), morphendes Value-Noise hebt einzelne Stellen darueber hinaus an. Heisse Zonen entstehen
 * lokal und vergehen wieder; ein statischer Verlauf vom Schwerpunkt nach aussen liest sich als
 * Kreis, eine gerichtete Sinuswelle als synchrones Aufflammen.
 */
export class GroundFireClusterRenderer {
  private readonly clusters = new Map<string, GroundFireCluster>();
  private readonly lightRecords = new Map<string, GroundFireLightRecord>();
  private readonly activeLightKeys = new Set<string>();
  private readonly lightRanking: GroundFireLightRecord[] = [];
  private snapshotSignature = '';
  private gpuVfx: GpuVfxSystem | null = null;
  private bedSpec: GpuVfxSpawnSpec | null = null;
  private fieldSpec: GpuVfxSpawnSpec | null = null;
  private coreSpec: GpuVfxSpawnSpec | null = null;
  private emberSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;
  private sparkAccentSpec: GpuVfxSpawnSpec | null = null;
  private smokeSpec: GpuVfxSpawnSpec | null = null;
  private source = GPU_VFX_NO_SOURCE_HANDLE;
  private lighting: LightingSystem | null = null;
  /** Network/world clock used for expiry; GPUFX has its own relative particle clock. */
  private synchronizedNow = 0;

  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;

    const bed = system.createSpec(GpuVfxEffectId.GroundFireHeatBody);
    bed.frame = GpuVfxFrameId.GroundFireBed;
    bed.yMode = GpuVfxEase.Linear;
    bed.scaleEase = GpuVfxEase.QuadOut;
    bed.alphaEnd = 0;
    // Das Bett ist Glut, kein zuendendes Gas: es wird in seiner Farbe geboren und bleibt darin.
    bed.tintBlendStart = 1;
    bed.tintBlendEnd = 1;
    this.bedSpec = bed;

    const field = system.createSpec(GpuVfxEffectId.GroundFireOuter);
    field.frame = GpuVfxFrameId.GroundFireSurface;
    field.yMode = GpuVfxEase.Linear;
    field.scaleEase = GpuVfxEase.QuadOut;
    field.alphaEnd = 0;
    field.tintBlendStart = 0.96;
    field.tintBlendEnd = 1;
    this.fieldSpec = field;

    const core = system.createSpec(GpuVfxEffectId.GroundFireCore);
    core.frame = GpuVfxFrameId.GroundFireSurface;
    core.yMode = GpuVfxEase.Linear;
    core.scaleEase = GpuVfxEase.QuadOut;
    core.alphaEnd = 0;
    core.tintBlendStart = 0.84;
    core.tintBlendEnd = 1;
    this.coreSpec = core;

    const ember = system.createSpec(GpuVfxEffectId.GroundFireEmber);
    ember.frame = GpuVfxFrameId.GroundFireSurface;
    ember.yMode = GpuVfxEase.Linear;
    ember.scaleEase = GpuVfxEase.QuadOut;
    ember.alphaEnd = 0;
    this.emberSpec = ember;

    const spark = system.createSpec(GpuVfxEffectId.GroundFireSpark);
    spark.frame = GpuVfxFrameId.FlameSpark;
    // Funken steigen und werden langsamer: die layerglobale Gravity der Lane ist -36 px/s²,
    // der volle Faktor ist hier genau richtig.
    spark.yMode = GpuVfxEase.Gravity;
    spark.gravityFactor = 1;
    spark.scaleStart = 1.1;
    spark.scaleEnd = 0.12;
    spark.alphaStart = 1;
    spark.alphaEnd = 0;
    spark.tintBlendStart = 0.28;
    spark.tintBlendEnd = 1;
    this.sparkSpec = spark;

    const sparkAccent = system.createSpec(GpuVfxEffectId.GroundFireSpark);
    sparkAccent.frame = GpuVfxFrameId.FlameSpark;
    sparkAccent.yMode = GpuVfxEase.Gravity;
    sparkAccent.gravityFactor = 1;
    sparkAccent.scaleEnd = 0.16;
    sparkAccent.alphaStart = 1;
    sparkAccent.alphaEnd = 0;
    sparkAccent.tintBlendStart = 0.08;
    sparkAccent.tintBlendEnd = 0.9;
    this.sparkAccentSpec = sparkAccent;

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
    sampleGroundFireMotion(x, y, nowMs, seed, MOTION);
    const dirX = MOTION.x;
    const dirY = MOTION.y;
    this.spawnBedAt(x, y, BED_SIZE_CELLS, 0.5, visualStyle, seed, nowMs, dirX, dirY, 1);
    this.spawnFieldAt(x, y, FIELD_SIZE_CELLS, 0.8, visualStyle, seed, nowMs, dirX, dirY, 1);
    this.spawnFieldAt(
      x + 4, y - 2, FIELD_SIZE_CELLS * 0.82, 0.7, visualStyle, seed ^ 0x41, nowMs, dirX, dirY, 0.9,
    );
    this.spawnCoreAt(x, y, CORE_SIZE_CELLS, 0.92, visualStyle, seed ^ 0x83, nowMs, dirX, dirY, 1);
    this.spawnEmberAt(x, y, EMBER_SIZE_CELLS, 0.95, visualStyle, seed ^ 0x1d, nowMs, dirX, dirY, 1);
    for (let index = 0; index < 4; index += 1) {
      this.spawnSparkAt(x, y, 0.9, visualStyle, seed ^ Math.imul(index + 1, 0x45d9f3b), nowMs);
    }
    this.spawnAccentSparkAt(x, y, 1, visualStyle, seed ^ 0x7f4a7c15, nowMs);
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
      spread: 0,
      effectiveCells: 1,
      bedOrder: new Int32Array(0),
      fieldOrder: new Int32Array(0),
      coreOrder: new Int32Array(0),
      emberOrder: new Int32Array(0),
      sparkOrder: new Int32Array(0),
      sparkAccentOrder: new Int32Array(0),
      smokeOrder: new Int32Array(0),
      bedCursor: 0,
      fieldCursor: 0,
      coreCursor: 0,
      emberCursor: 0,
      sparkCursor: 0,
      sparkAccentCursor: 0,
      smokeCursor: 0,
      bedFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_BED_LIFESPAN)),
      fieldFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_FIELD_LIFESPAN)),
      coreFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_CORE_LIFESPAN)),
      emberFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_EMBER_LIFESPAN)),
      sparkFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_SPARK_LIFESPAN)),
      sparkAccentFlow: new ParticleFlowScheduler(this.averageLife(GROUND_FIRE_SPARK_ACCENT_LIFESPAN)),
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
    cluster.spread = Phaser.Math.Clamp(
      (layout.cells.length - 1) / (GROUND_FIRE_SPREAD_CELLS - 1),
      0,
      1,
    );

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
    cluster.fieldFlow.primeForImmediateEmission();
    cluster.coreFlow.primeForImmediateEmission();
    cluster.emberFlow.primeForImmediateEmission();
    cluster.sparkFlow.primeForImmediateEmission();
    cluster.sparkAccentFlow.primeForImmediateEmission();
    cluster.smokeFlow.primeForImmediateEmission();
  }

  /**
   * Baut das Zellfeld neu: Weltmittelpunkte, Randdistanz und die schichtspezifischen Permutationen.
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

    cluster.bedOrder = buildGroundFireTraversal(count, cluster.seed, 11);
    cluster.fieldOrder = buildGroundFireTraversal(count, cluster.seed, 23);
    cluster.coreOrder = buildGroundFireTraversal(count, cluster.seed, 37);
    cluster.emberOrder = buildGroundFireTraversal(count, cluster.seed, 53);
    cluster.sparkOrder = buildGroundFireTraversal(count, cluster.seed, 71);
    cluster.sparkAccentOrder = buildGroundFireTraversal(count, cluster.seed, 89);
    cluster.smokeOrder = buildGroundFireTraversal(count, cluster.seed, 107);

    // Auch der erste Zugriff beginnt pro Schicht an einer anderen Stelle der Permutation.
    cluster.bedCursor = this.seededUnit(cluster.seed, 113) * count | 0;
    cluster.fieldCursor = this.seededUnit(cluster.seed, 127) * count | 0;
    cluster.coreCursor = this.seededUnit(cluster.seed, 131) * count | 0;
    cluster.emberCursor = this.seededUnit(cluster.seed, 137) * count | 0;
    cluster.sparkCursor = this.seededUnit(cluster.seed, 139) * count | 0;
    cluster.sparkAccentCursor = this.seededUnit(cluster.seed, 149) * count | 0;
    cluster.smokeCursor = this.seededUnit(cluster.seed, 151) * count | 0;
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
        BED_MIN_LIVE, GpuVfxEffectId.GroundFireHeatBody, intensity, nowMs, this.spawnBed,
      );
      this.runFlow(
        cluster, cluster.fieldFlow, deltaMs, GROUND_FIRE_FIELD_LIFESPAN, FIELD_DENSITY_PER_CELL,
        FIELD_MIN_LIVE, GpuVfxEffectId.GroundFireOuter, intensity, nowMs, this.spawnField,
      );
      this.runFlow(
        cluster, cluster.coreFlow, deltaMs, GROUND_FIRE_CORE_LIFESPAN, CORE_DENSITY_PER_CELL,
        CORE_MIN_LIVE, GpuVfxEffectId.GroundFireCore, intensity, nowMs, this.spawnCore,
      );
      this.runFlow(
        cluster, cluster.emberFlow, deltaMs, GROUND_FIRE_EMBER_LIFESPAN, EMBER_DENSITY_PER_CELL,
        EMBER_MIN_LIVE, GpuVfxEffectId.GroundFireEmber, intensity, nowMs, this.spawnEmber,
      );
      this.runFlow(
        cluster, cluster.sparkFlow, deltaMs, GROUND_FIRE_SPARK_LIFESPAN, GROUND_FIRE_SPARK_DENSITY_PER_CELL,
        SPARK_MIN_LIVE, GpuVfxEffectId.GroundFireSpark, intensity, nowMs, this.spawnClusterSpark,
      );
      this.runFlow(
        cluster, cluster.sparkAccentFlow, deltaMs, GROUND_FIRE_SPARK_ACCENT_LIFESPAN,
        GROUND_FIRE_SPARK_ACCENT_DENSITY_PER_CELL, SPARK_ACCENT_MIN_LIVE,
        GpuVfxEffectId.GroundFireSpark, intensity, nowMs, this.spawnClusterAccentSpark,
      );
      if (intensity > 0.5) {
        this.runFlow(
          cluster, cluster.smokeFlow, deltaMs, GROUND_FIRE_SMOKE_LIFESPAN, SMOKE_DENSITY_PER_CELL,
          SMOKE_MIN_LIVE, GpuVfxEffectId.GroundFireSmoke, intensity, nowMs, this.spawnSmoke,
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
    minLive: number,
    effect: GpuVfxEffectId,
    intensity: number,
    nowMs: number,
    spawn: (this: GroundFireClusterRenderer, cluster: GroundFireCluster, intensity: number, nowMs: number) => void,
  ): void {
    const system = this.gpuVfx;
    if (!system) return;

    const targetLive = Math.max(minLive, cluster.effectiveCells * densityPerCell);
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
    const cell = this.pickCell(cluster, cluster.bedOrder, cluster.bedCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.bedCursor, -1640531527);
    sampleGroundFireMotion(cell.x, cell.y, nowMs, cluster.seed, MOTION);
    const dirX = MOTION.x;
    const dirY = MOTION.y;
    const scatter = this.scatterScale(cluster) * CELL * 1.25;
    // Etwas ueber die Zelle hinaus gestreut: eine exakt auf die Zelle geklemmte Streuung zeichnet
    // das Raster nach, sobald die Flanken der Motive uebereinanderliegen.
    this.spawnBedAt(
      cell.x + (this.seededUnit(seed, 53) - 0.5) * scatter,
      cell.y + (this.seededUnit(seed, 59) - 0.5) * scatter,
      BED_SIZE_CELLS * (0.88 + this.seededUnit(seed, 61) * 0.26),
      this.heatAt(cluster, cell, MOTION.heat, intensity) * 0.72,
      cluster.visualStyle,
      seed,
      nowMs,
      dirX,
      dirY,
      fade * cell.intensity,
    );
  }

  private spawnField(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const cell = this.pickCell(cluster, cluster.fieldOrder, cluster.fieldCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.fieldCursor, -1640531527);
    sampleGroundFireMotion(cell.x, cell.y, nowMs, cluster.seed, MOTION);
    const dirX = MOTION.x;
    const dirY = MOTION.y;
    const scatter = this.scatterScale(cluster) * CELL;
    const size = FIELD_SIZE_CELLS
      * (0.86 + this.seededUnit(seed, 23) * 0.3) * (0.94 + intensity * 0.08);
    this.spawnFieldAt(
      cell.x + (this.seededUnit(seed, 67) - 0.5) * scatter,
      cell.y + (this.seededUnit(seed, 71) - 0.5) * scatter,
      size,
      this.heatAt(cluster, cell, MOTION.heat, intensity),
      cluster.visualStyle,
      seed,
      nowMs,
      dirX,
      dirY,
      fade * cell.intensity,
    );
  }

  /**
   * Das Heissfeld: dieselbe Wolke, kleiner und heisser. Turnier aus zwei Kandidaten – die
   * heissere Zelle gewinnt. Das schiebt die Hitze ins Innere, ohne den Rand ganz auszuschliessen;
   * ein reiner Kernfilter liesse die Raender kalt.
   */
  private spawnCore(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const first = this.pickCell(cluster, cluster.coreOrder, cluster.coreCursor++);
    const second = this.pickCell(cluster, cluster.coreOrder, cluster.coreCursor + 7);
    if (!first) return;
    const cell = second && second.coreness > first.coreness ? second : first;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.coreCursor, -2048144789);
    sampleGroundFireMotion(cell.x, cell.y, nowMs, cluster.seed, MOTION);
    const dirX = MOTION.x;
    const dirY = MOTION.y;
    const scatter = this.scatterScale(cluster) * CELL * 0.8;
    this.spawnCoreAt(
      cell.x + (this.seededUnit(seed, 73) - 0.5) * scatter,
      cell.y + (this.seededUnit(seed, 79) - 0.5) * scatter,
      CORE_SIZE_CELLS * (0.82 + this.seededUnit(seed, 83) * 0.42) * (0.92 + intensity * 0.14),
      Math.max(0.5, this.heatAt(cluster, cell, MOTION.heat, intensity) + 0.14),
      cluster.visualStyle,
      seed,
      nowMs,
      dirX,
      dirY,
      fade * cell.intensity,
    );
  }

  /**
   * Glutnester: kleine, sehr helle Wolken bevorzugt im Kern. Sie tragen den lokalen Kontrast,
   * an dem eine Flaeche als *brennend* statt als beleuchtet gelesen wird – ohne eigene Form und
   * ohne eigenes Flackern, sonst wird die Flaeche unruhig.
   */
  private spawnEmber(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const first = this.pickCell(cluster, cluster.emberOrder, cluster.emberCursor++);
    const second = this.pickCell(cluster, cluster.emberOrder, cluster.emberCursor + 13);
    if (!first) return;
    const cell = second && second.coreness > first.coreness ? second : first;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.emberCursor, 0x9e3779b1);
    sampleGroundFireMotion(cell.x, cell.y, nowMs, cluster.seed, MOTION);
    const dirX = MOTION.x;
    const dirY = MOTION.y;
    const scatter = this.scatterScale(cluster) * CELL * 0.9;
    this.spawnEmberAt(
      cell.x + (this.seededUnit(seed, 31) - 0.5) * scatter,
      cell.y + (this.seededUnit(seed, 37) - 0.5) * scatter,
      EMBER_SIZE_CELLS * (0.78 + this.seededUnit(seed, 41) * 0.56),
      Math.max(0.55, this.heatAt(cluster, cell, MOTION.heat, intensity) + 0.2),
      cluster.visualStyle,
      seed,
      nowMs,
      dirX,
      dirY,
      fade * cell.intensity,
    );
  }

  private spawnClusterSpark(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const cell = this.pickCell(cluster, cluster.sparkOrder, cluster.sparkCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.sparkCursor, -1028477387);
    this.spawnSparkAt(cell.x, cell.y, intensity * (0.72 + cell.coreness * 0.3), cluster.visualStyle, seed, nowMs, fade);
  }

  private spawnClusterAccentSpark(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const cell = this.pickCell(cluster, cluster.sparkAccentOrder, cluster.sparkAccentCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.sparkAccentCursor, 0x27d4eb2d);
    this.spawnAccentSparkAt(
      cell.x,
      cell.y,
      intensity * (0.82 + cell.coreness * 0.28),
      cluster.visualStyle,
      seed,
      nowMs,
      fade,
    );
  }

  private spawnSmoke(cluster: GroundFireCluster, intensity: number, nowMs: number): void {
    const spec = this.smokeSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    const cell = this.pickCell(cluster, cluster.smokeOrder, cluster.smokeCursor++);
    if (!cell) return;
    const fade = this.cellFade(cell);
    if (fade <= 0) return;
    const seed = cell.seed ^ Math.imul(cluster.smokeCursor, 0x9e3779b1);
    spec.lifeMs = this.seededRange(seed, 71, GROUND_FIRE_SMOKE_LIFESPAN.min, GROUND_FIRE_SMOKE_LIFESPAN.max);
    spec.x = cell.x + (this.seededUnit(seed, 89) - 0.5) * CELL;
    spec.y = cell.y - 3;
    spec.vx = (this.seededUnit(seed, 73) - 0.5) * 6;
    spec.vy = -5 - this.seededUnit(seed, 79) * 7;
    spec.rotation = this.seededUnit(seed, 83) * TWO_PI;
    spec.alphaStart = 0.08 * intensity * fade;
    spec.tint = 0x75675d;
    system.spawn(spec, this.source, nowMs);
  }

  // ── Einzelne Spawns ────────────────────────────────────────────────────────

  private spawnBedAt(
    x: number,
    y: number,
    sizeCells: number,
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
    spec.frame = this.pickFrame(GROUND_FIRE_BED_FRAMES, seed, 89);
    spec.lifeMs = this.seededRange(seed, 97, GROUND_FIRE_BED_LIFESPAN.min, GROUND_FIRE_BED_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = dirX * BED_DRIFT_SPEED;
    spec.vy = dirY * BED_DRIFT_SPEED;
    spec.rotation = this.seededUnit(seed, 95) * TWO_PI;
    spec.angularVelocity = (this.seededUnit(seed, 96) - 0.5) * 0.1;
    spec.scaleStart = sizeCells * CELL / GROUND_FIRE_BED_SIZE;
    // Die Glut breitet sich kaum aus; ein wachsendes Bett wuerde ueber die Brandflaeche
    // hinauslaufen und ihre Kante ausfransen.
    spec.scaleEnd = spec.scaleStart * 1.02;
    spec.stretchStart = 0.92 + this.seededUnit(seed, 98) * 0.32;
    spec.stretchEnd = 0.96;
    spec.alphaStart = BED_ALPHA * fade;
    spec.tint = this.pickHeatTint(style, heat, seed, 103);
    system.spawn(spec, this.source, nowMs);
  }

  private spawnFieldAt(
    x: number,
    y: number,
    sizeCells: number,
    heat: number,
    style: GroundFireVisualStyle,
    seed: number,
    nowMs: number,
    dirX: number,
    dirY: number,
    fade: number,
  ): void {
    const spec = this.fieldSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    spec.frame = this.pickFrame(GROUND_FIRE_SURFACE_FRAMES, seed, 97);
    spec.lifeMs = this.seededRange(seed, 101, GROUND_FIRE_FIELD_LIFESPAN.min, GROUND_FIRE_FIELD_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = dirX * FIELD_DRIFT_SPEED;
    spec.vy = dirY * FIELD_DRIFT_SPEED;
    // Die Flaechenmaske ist rotationssymmetrisch genug fuer ein freies Drehen; dadurch entstehen
    // keine wiedererkennbaren, gleich ausgerichteten Einzelmotive im Raster.
    spec.rotation = this.seededUnit(seed, 99) * TWO_PI;
    spec.angularVelocity = (this.seededUnit(seed, 100) - 0.5) * 0.2;
    spec.scaleStart = sizeCells * CELL / GROUND_FIRE_SURFACE_SIZE;
    spec.scaleEnd = spec.scaleStart * (1.04 + this.seededUnit(seed, 102) * 0.08);
    spec.stretchStart = 0.9 + this.seededUnit(seed, 105) * 0.48;
    spec.stretchEnd = 0.96 + this.seededUnit(seed, 106) * 0.18;
    spec.alphaStart = FIELD_ALPHA * fade;
    spec.tint = this.pickHeatTint(style, heat, seed, 107);
    system.spawn(spec, this.source, nowMs);
  }

  /** Das Heissfeld: dieselbe organische Motivfamilie wie das Flaechenfeld, kleiner und heller. */
  private spawnCoreAt(
    x: number,
    y: number,
    sizeCells: number,
    heat: number,
    style: GroundFireVisualStyle,
    seed: number,
    nowMs: number,
    dirX: number,
    dirY: number,
    fade: number,
  ): void {
    const spec = this.coreSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    spec.frame = this.pickFrame(GROUND_FIRE_SURFACE_FRAMES, seed, 101);
    spec.lifeMs = this.seededRange(seed, 109, GROUND_FIRE_CORE_LIFESPAN.min, GROUND_FIRE_CORE_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = dirX * CORE_DRIFT_SPEED;
    spec.vy = dirY * CORE_DRIFT_SPEED;
    spec.rotation = this.seededUnit(seed, 111) * TWO_PI;
    spec.angularVelocity = (this.seededUnit(seed, 112) - 0.5) * 0.16;
    spec.scaleStart = sizeCells * CELL / GROUND_FIRE_SURFACE_SIZE;
    spec.scaleEnd = spec.scaleStart * (1.06 + this.seededUnit(seed, 114) * 0.1);
    spec.stretchStart = 0.88 + this.seededUnit(seed, 113) * 0.4;
    spec.stretchEnd = 0.96 + this.seededUnit(seed, 115) * 0.16;
    spec.alphaStart = CORE_ALPHA * fade;
    spec.tint = this.pickHeatTint(style, Math.max(heat, 0.5), seed, 127);
    system.spawn(spec, this.source, nowMs);
  }

  /**
   * Ein Glutnest: dieselbe Wolke, klein und sehr hell. Es wird heisser geboren als es ausbrennt
   * (`tintBlend` 0.62 -> 1), das ist die Temperaturkurve eines Glutpartikels.
   */
  private spawnEmberAt(
    x: number,
    y: number,
    sizeCells: number,
    heat: number,
    style: GroundFireVisualStyle,
    seed: number,
    nowMs: number,
    dirX: number,
    dirY: number,
    fade: number,
  ): void {
    const spec = this.emberSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    spec.frame = this.pickFrame(GROUND_FIRE_SURFACE_FRAMES, seed, 41);
    const scale = sizeCells * CELL / GROUND_FIRE_SURFACE_SIZE;
    spec.lifeMs = this.seededRange(seed, 43, GROUND_FIRE_EMBER_LIFESPAN.min, GROUND_FIRE_EMBER_LIFESPAN.max);
    spec.x = x;
    spec.y = y;
    spec.vx = dirX * EMBER_DRIFT_SPEED;
    spec.vy = dirY * EMBER_DRIFT_SPEED;
    spec.rotation = this.seededUnit(seed, 47) * TWO_PI;
    spec.angularVelocity = 0;
    spec.scaleStart = scale;
    // Ein Glutnest brennt herunter, es dehnt sich nicht aus.
    spec.scaleEnd = scale * 0.82;
    spec.stretchStart = 0.86 + this.seededUnit(seed, 53) * 0.36;
    spec.stretchEnd = 1;
    spec.alphaStart = EMBER_ALPHA * fade * (0.72 + heat * 0.34);
    // Void bleibt naeher an seiner Farbe: der Stil lebt vom Violett, nicht von der Hitze.
    spec.tintBlendStart = style === 'void' ? 0.82 : 0.62;
    spec.tintBlendEnd = 1;
    spec.tint = this.pickEmberTint(style, seed, 59);
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
    spec.x = x + Math.cos(phase) * 5;
    spec.y = y + Math.sin(phase) * 5;
    const speed = 10 + intensity * 10 + this.seededUnit(seed, 133) * 8;
    spec.vx = Math.cos(phase) * speed;
    spec.vy = Math.sin(phase) * speed - 10 - this.seededUnit(seed, 135) * 12;
    spec.rotation = phase;
    spec.angularVelocity = (this.seededUnit(seed, 139) - 0.5) * 0.8;
    spec.alphaStart = Phaser.Math.Clamp(0.78 + intensity * 0.3, 0.65, 1) * fade;
    spec.tint = this.pickEmberTint(style, seed, 149);
    system.spawn(spec, this.source, nowMs);
  }

  private spawnAccentSparkAt(
    x: number,
    y: number,
    intensity: number,
    style: GroundFireVisualStyle,
    seed: number,
    nowMs: number,
    fade = 1,
  ): void {
    const spec = this.sparkAccentSpec;
    const system = this.gpuVfx;
    if (!spec || !system) return;
    // Oberer Halbkreis: die lange lokale X-Achse zeigt entlang der Flugrichtung.
    const phase = -Math.PI + this.seededUnit(seed, 157) * Math.PI;
    const speed = this.seededRange(seed, 163, 35, 70);
    spec.lifeMs = this.seededRange(
      seed,
      167,
      GROUND_FIRE_SPARK_ACCENT_LIFESPAN.min,
      GROUND_FIRE_SPARK_ACCENT_LIFESPAN.max,
    );
    spec.x = x + (this.seededUnit(seed, 173) - 0.5) * CELL * 0.7;
    spec.y = y + (this.seededUnit(seed, 179) - 0.5) * CELL * 0.7;
    spec.vx = Math.cos(phase) * speed;
    spec.vy = Math.sin(phase) * speed - 8;
    spec.rotation = phase;
    spec.angularVelocity = 0;
    spec.scaleStart = this.seededRange(seed, 181, 1.4, 2.2);
    spec.scaleEnd = 0.16;
    spec.stretchStart = this.seededRange(seed, 191, 1.4, 2);
    spec.stretchEnd = 0.45;
    spec.alphaStart = Phaser.Math.Clamp(0.88 + intensity * 0.18, 0.78, 1) * fade;
    spec.tint = this.pickEmberTint(style, seed, 193);
    system.spawn(spec, this.source, nowMs);
  }

  // ── Felder ─────────────────────────────────────────────────────────────────

  /**
   * Temperatur einer Zelle: Grundverlauf ueber die Randdistanz plus das lokal morphende Noise.
   * Das Noise hat keine globale Bewegungsrichtung; heisse Zonen entstehen und vergehen vor Ort,
   * statt als sichtbare Welle durch die sortierte Zellkarte zu laufen.
   *
   * `coreness` bekommt eine Untergrenze aus `spread`: in einem kleinen Cluster ist *jede* Zelle
   * das Feuer und nicht sein Rand. Ohne diese Untergrenze landete eine einzelne brennende Zelle
   * immer im kuehlen Farbband und blieb dunkelrot – genau der Grund, warum sie nur als Glut und
   * nicht als Feuer las.
   */
  private heatAt(
    cluster: GroundFireCluster,
    cell: GroundFireCellField,
    localHeat: number,
    intensity: number,
  ): number {
    const coreness = Math.max(cell.coreness, 1 - cluster.spread);
    return Phaser.Math.Clamp(
      0.26 + coreness * 0.38 + localHeat * 0.22 + intensity * 0.14,
      0,
      1,
    );
  }

  /** Restliche Brenndauer *dieser Zelle*; laesst eine Flaeche von aussen zurueckweichen. */
  private cellFade(cell: GroundFireCellField): number {
    return Phaser.Math.Clamp((cell.expiresAt - this.synchronizedNow) / GROUND_FIRE_FADE_MS, 0, 1);
  }

  /** Streuung um die Zellmitte, relativ zur Streuung einer ausgedehnten Flaeche. */
  private scatterScale(cluster: GroundFireCluster): number {
    return 0.45 + 0.55 * cluster.spread;
  }

  /**
   * Die naechste Zelle einer schichtspezifischen Permutation. Jede Schicht trifft jede Zelle
   * genau einmal pro Umlauf, aber in einer anderen, nicht raeumlich sortierten Reihenfolge.
   */
  private pickCell(
    cluster: GroundFireCluster,
    order: Int32Array,
    cursor: number,
  ): GroundFireCellField | null {
    const count = order.length;
    if (count === 0) return null;
    return cluster.field[order[cursor % count]] ?? null;
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
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.GroundFireEmber);
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

  private pickEmberTint(style: GroundFireVisualStyle, seed: number, salt: number): number {
    const palette = style === 'void' ? GROUND_FIRE_VOID_TINTS_EMBER : GROUND_FIRE_TINTS_EMBER;
    return palette[Math.floor(this.seededUnit(seed, salt) * palette.length)];
  }

  private seededRange(seed: number, salt: number, min: number, max: number): number {
    return min + this.seededUnit(seed, salt) * (max - min);
  }

  private pickFrame(frames: readonly GpuVfxFrameId[], seed: number, salt: number): GpuVfxFrameId {
    return frames[Math.floor(this.seededUnit(seed, salt) * frames.length)];
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
