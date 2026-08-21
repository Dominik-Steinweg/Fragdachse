import * as Phaser from 'phaser';
import { GPU_VFX_ATLAS_KEY, buildGpuVfxAtlas, getGpuVfxFrame } from './GpuVfxAtlas';
import { GPU_VFX_EASE_NAMES } from './GpuVfxEase';
import { GPU_VFX_EFFECTS, type GpuVfxEffectId, type GpuVfxImportance } from './GpuVfxEffects';
import { GPU_VFX_DEAD_MEMBER, writeGpuVfxMember } from './GpuVfxMember';
import { GPU_VFX_NO_SLOT, GpuVfxPool, type GpuVfxPoolStats } from './GpuVfxPool';
import { GpuVfxProfiler, type GpuVfxReport } from './GpuVfxProfiler';
import { GpuVfxQuality } from './GpuVfxQuality';
import { GPU_VFX_LANES, type GpuVfxLaneId, type GpuVfxLaneSpec } from './GpuVfxRenderLanes';
import type { GpuVfxSpawnSpec } from './GpuVfxSpawnSpec';

/**
 * GpuVfxSystem – das gemeinsame GPU-VFX-Backend einer Szene.
 *
 * Effektcontroller entscheiden weiterhin *wann*, *wo*, *wie oft* und *mit welcher semantischen
 * Konfiguration* ein Partikel entsteht. Alles danach liegt hier: Lane-Auswahl, Slot-Vergabe,
 * Member-Konfiguration, Lebenszeit, Source-Lifecycle, Quality, Admission, Ablation,
 * Idle-Sichtbarkeit und Profiling.
 *
 * Ein Controller legt damit weder eigene `SpriteGPULayer` an noch besitzt er einen eigenen Pool,
 * und er sieht keine Phaser-GPU-Interna mehr.
 *
 * ## Reihenfolge in `update()`
 *
 * Erst stilllegen, dann emittieren – das ist Vertrag. Der Pool vergibt ausschliesslich freie
 * Slots; ein Spawn vor dem Retire-Sweep wuerde sonst unnoetig als Kapazitaets-Verwurf abgewiesen.
 * Effekte melden ihren Emissions-Tick deshalb hier an, statt selbst pro Frame gerufen zu werden.
 *
 * ## Sichtbarkeit
 *
 * Ein geprimter Layer zeichnet `memberCount` Instanzen, auch wenn kein Partikel lebt. Lanes ohne
 * lebende Member werden deshalb unsichtbar geschaltet. Ablation und Idle teilen sich genau einen
 * Resolver, damit nicht zwei Schreiber um `visible` kaempfen; die Ablation hat Vorrang.
 */

/**
 * Admission-Control einer Lane.
 *
 * Die obersten `reserveCritical` Slots nimmt nur `critical` an – eine rein logische Reserve auf
 * `liveCount`, kein physisch reservierter Indexbereich. Ein reservierter Bereich wuerde den Ring
 * fragmentieren und damit die Slot-Lokalitaet der Buffer-Uploads verschlechtern.
 *
 * Bewusst keine Auslastungsschwellen (60/80 %): die haengen an der frei gewaehlten Kapazitaet,
 * und auf einer geteilten Lane wuerde ein viel emittierender Effekt fremde Effekte mitdrosseln.
 */
export function admitGpuVfxSpawn(
  liveCount: number,
  capacity: number,
  reserveCritical: number,
  importance: GpuVfxImportance,
): boolean {
  if (liveCount >= capacity) return false;
  if (importance === 'critical' || reserveCritical <= 0) return true;
  return liveCount < capacity - reserveCritical;
}

/** Wird pro Renderframe gerufen, nachdem abgelaufene Member stillgelegt wurden. */
export type GpuVfxEmissionTick = (deltaMs: number, nowMs: number) => void;

/** Rueckgabe von `createSource()`, wenn die Source-Tabelle erschoepft ist. */
export const GPU_VFX_NO_SOURCE_HANDLE = -1;

/**
 * Gleichzeitig lebende Quellen ueber alle Effekte. Grosszuegig bemessen: Raketen sind mit Abstand
 * am zahlreichsten und teilen sich fuer den Rauch ohnehin eine Quelle.
 */
const MAX_SOURCES = 1024;

const SOURCE_FREE   = 0;
const SOURCE_KILL   = 1;
const SOURCE_LINGER = 2;

interface GpuVfxLane {
  readonly spec: GpuVfxLaneSpec;
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  readonly pool: GpuVfxPool;
  visible: boolean;
  lastTimeElapsed: number;
}

export class GpuVfxSystem {
  private readonly lanes: GpuVfxLane[] = [];
  private readonly ticks: GpuVfxEmissionTick[] = [];
  private readonly laneStats: GpuVfxPoolStats[] = [];
  readonly quality: GpuVfxQuality;
  private readonly profiler = new GpuVfxProfiler();

  /** `SOURCE_FREE` heisst frei; sonst der Release-Modus des Effekts, der sie angelegt hat. */
  private readonly sourceMode = new Uint8Array(MAX_SOURCES);
  private readonly sourceFreeList = new Int32Array(MAX_SOURCES);
  private sourceFreeCount = MAX_SOURCES;

  /** Gemeinsame monotone Uhr fuer Slot-Lebenszeiten, gleich getaktet mit den GPU-Animationen. */
  private clockMs = 0;
  private suppressed = false;

  constructor(scene: Phaser.Scene) {
    // Der Atlas muss vollstaendig sein, bevor die erste Lane entsteht: `frameDataTexture` wird im
    // Konstruktor des Layers gebaut, spaeter ergaenzte Frames existieren fuer den Shader nicht.
    buildGpuVfxAtlas(scene);
    this.quality = new GpuVfxQuality(scene);

    for (const spec of GPU_VFX_LANES) {
      const layer = scene.add.spriteGPULayer(GPU_VFX_ATLAS_KEY, spec.capacity);
      // Alle Lanes teilen sich den Atlas; der Name ist danach das einzige Unterscheidungsmerkmal
      // in Debugger und Diagnose.
      layer.name = spec.label;
      layer.setBlendMode(spec.blendMode);
      layer.setDepth(spec.depth);
      if (spec.gravity !== undefined) layer.gravity = spec.gravity;
      // Ein erstmals auftauchender Ease-Typ laesst Shader und FrameData neu bauen; hier
      // vorgewaermt passiert das nie im Spielverlauf.
      for (const ease of spec.eases) layer.setAnimationEnabled(GPU_VFX_EASE_NAMES[ease], true);

      const pool = new GpuVfxPool(layer, spec.capacity, spec.label, MAX_SOURCES);
      pool.prime(GPU_VFX_DEAD_MEMBER);
      // Leere Lanes zeichnen sonst ihre volle Kapazitaet an Instanzen.
      layer.setVisible(false);

      this.lanes.push({ spec, layer, pool, visible: false, lastTimeElapsed: layer.timeElapsed });
    }

    for (let index = 0; index < MAX_SOURCES; index += 1) this.sourceFreeList[index] = index;
  }

  // ── Spawn-Schnittstelle ────────────────────────────────────────────────────

  /**
   * Ein Spec je Controller, einmalig ausgegeben und danach nur noch mutiert. Vorbelegt mit Lane
   * und Frame des Effekts; Werte, die jeder Effekt ohnehin setzt, stehen auf neutralen Defaults.
   */
  createSpec(effect: GpuVfxEffectId): GpuVfxSpawnSpec {
    const spec = GPU_VFX_EFFECTS[effect];
    return {
      effect,
      lane: spec.lane,
      frame: spec.frame,
      lifeMs: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      yMode: 0,
      rotation: 0, angularVelocity: 0,
      scaleStart: 1, scaleEnd: 1, scaleEase: 0,
      alphaStart: 1, alphaEnd: 0, alphaEase: 0,
      tint: 0xffffff,
    };
  }

  /**
   * Erzeugt genau ein Partikel. `sourceIndex` darf `GPU_VFX_NO_SOURCE_HANDLE` sein – der Member
   * lebt dann einfach aus und gehoert zu niemandem.
   *
   * Liefert `false`, wenn der Spawn verworfen wurde; getrennt gezaehlt nach Kapazitaet und
   * kritischer Reserve.
   */
  spawn(spec: GpuVfxSpawnSpec, sourceIndex: number, nowMs: number): boolean {
    const lane = this.lanes[spec.lane];
    this.profiler.recordAttempt(spec.effect);
    if (!lane) return false;

    if (!admitGpuVfxSpawn(
      lane.pool.getLiveCount(),
      lane.spec.capacity,
      lane.spec.reserveCritical,
      GPU_VFX_EFFECTS[spec.effect].importance,
    )) {
      // Auf beiden Ebenen buchen: die Lane sieht ihre Auslastung, der Effekt seinen Verlust.
      lane.pool.recordCapacityDrop();
      this.profiler.recordCapacityDrop(spec.effect);
      return false;
    }

    const slot = lane.pool.acquire(sourceIndex, nowMs, spec.lifeMs);
    if (slot === GPU_VFX_NO_SLOT) {
      this.profiler.recordCapacityDrop(spec.effect);
      return false;
    }

    lane.layer.editMember(slot, writeGpuVfxMember(spec, getGpuVfxFrame(spec.frame)));
    this.profiler.recordSpawn(spec.effect);
    // Auch Spawns ausserhalb des Emissions-Ticks muessen ihre Lane sofort sichtbar machen,
    // sonst faellt das erste Partikel eines Bursts einen Frame lang aus.
    this.applyVisibility(lane);
    return true;
  }

  /** Ein vom Controller unterdrueckter Spawn (Qualitaetsfaktor) – zaehlt getrennt. */
  recordQualityDrop(effect: GpuVfxEffectId, count = 1): void {
    for (let n = 0; n < count; n += 1) this.profiler.recordQualityDrop(effect);
  }

  // ── Source-Lifecycle ───────────────────────────────────────────────────────

  /**
   * Legt eine Quelle an. Der Release-Modus kommt aus dem Effekt-Manifest: `kill-with-source`
   * legt die Member beim Freigeben still, `linger` loest sie nur von der Quelle.
   */
  createSource(effect: GpuVfxEffectId): number {
    if (this.sourceFreeCount === 0) return GPU_VFX_NO_SOURCE_HANDLE;
    this.sourceFreeCount -= 1;
    const index = this.sourceFreeList[this.sourceFreeCount];
    this.sourceMode[index] = GPU_VFX_EFFECTS[effect].release === 'linger' ? SOURCE_LINGER : SOURCE_KILL;
    return index;
  }

  /**
   * Gibt eine Quelle frei. Bei `linger` werden ihre Member vorher von ihr geloest – erst das
   * macht das Recyceln des Index sicher, weil ein spaeterer Besitzer sonst fremde Member
   * stilllegen koennte.
   */
  releaseSource(sourceIndex: number): void {
    if (sourceIndex < 0 || sourceIndex >= MAX_SOURCES) return;
    const mode = this.sourceMode[sourceIndex];
    if (mode === SOURCE_FREE) return;

    for (let index = 0; index < this.lanes.length; index += 1) {
      const pool = this.lanes[index].pool;
      if (mode === SOURCE_LINGER) pool.detachSource(sourceIndex);
      else pool.releaseSource(sourceIndex);
    }

    this.sourceMode[sourceIndex] = SOURCE_FREE;
    this.sourceFreeList[this.sourceFreeCount] = sourceIndex;
    this.sourceFreeCount += 1;
  }

  /**
   * Legt alle Member einer Quelle still, laesst die Quelle selbst aber bestehen. Fuer
   * langlebige, geteilte Quellen (etwa den Raketenrauch, den sich alle Raketen teilen), deren
   * Material beim Rundenteardown verschwinden soll, ohne dass der Controller einen neuen
   * Handle beschaffen muss.
   */
  clearSource(sourceIndex: number): void {
    if (sourceIndex < 0 || sourceIndex >= MAX_SOURCES) return;
    if (this.sourceMode[sourceIndex] === SOURCE_FREE) return;
    for (let index = 0; index < this.lanes.length; index += 1) {
      const lane = this.lanes[index];
      lane.pool.releaseSource(sourceIndex);
      this.applyVisibility(lane);
    }
  }

  // ── Frame-Lifecycle ────────────────────────────────────────────────────────

  /** Meldet den Emissions-Tick eines Effekts an. Reihenfolge der Anmeldung = Reihenfolge im Frame. */
  registerEmission(tick: GpuVfxEmissionTick): void {
    this.ticks.push(tick);
  }

  /** Aktueller Stand der Partikeluhr; identisch mit dem, was `update()` den Ticks uebergibt. */
  now(): number {
    return this.clockMs;
  }

  isSuppressed(): boolean {
    return this.suppressed;
  }

  /**
   * Pro Renderframe aufzurufen, unabhaengig von Rolle und Netzzustand: die bisherigen Emitter
   * liefen autonom weiter, auch wenn gerade kein neuer Zustand ankam.
   */
  update(deltaMs: number): void {
    this.clockMs += deltaMs;

    for (let index = 0; index < this.lanes.length; index += 1) {
      const lane = this.lanes[index];
      lane.pool.beginFrame();
      this.handleTimeWrap(lane);
      lane.pool.retireExpired(this.clockMs);
    }

    // Waehrend der Ablation ruhen Rendering *und* Scheduler. Die Flow-Countdowns der Effekte
    // bleiben unangetastet, damit beim Segmentende nichts nachgeholt wird.
    if (!this.suppressed) {
      for (let index = 0; index < this.ticks.length; index += 1) {
        this.ticks[index](deltaMs, this.clockMs);
      }
    }

    let activeMask = 0;
    for (let index = 0; index < this.lanes.length; index += 1) {
      const lane = this.lanes[index];
      this.applyVisibility(lane);
      if (lane.pool.getLiveCount() > 0) activeMask |= (1 << index);
    }
    this.profiler.recordFrame(this.suppressed ? 0 : activeMask);
  }

  /**
   * Ablations-Hook. GPU-Zeit laesst sich nicht anhalten, deshalb ist das Stilllegen der
   * laufenden Member das Aequivalent zum `setActive(false)` der klassischen Emitter.
   */
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    for (const lane of this.lanes) {
      if (suppressed) lane.pool.releaseAll();
      this.applyVisibility(lane);
    }
  }

  releaseAll(): void {
    for (const lane of this.lanes) {
      lane.pool.releaseAll();
      this.applyVisibility(lane);
    }
    this.quality.resetAllCarry();
  }

  destroy(): void {
    this.quality.destroy();
  }

  // ── Diagnose ───────────────────────────────────────────────────────────────

  /** Live-Ansicht fuer das Overlay: Lane-Label -> Poolzustand. */
  getStats(): Record<string, GpuVfxPoolStats> | null {
    if (this.lanes.length === 0) return null;
    const stats: Record<string, GpuVfxPoolStats> = {};
    for (const lane of this.lanes) stats[lane.spec.label] = lane.pool.getStats();
    return stats;
  }

  /** Vollstaendiger Zwei-Ebenen-Report fuer den Performance-Export. */
  buildReport(): GpuVfxReport {
    this.laneStats.length = 0;
    for (const lane of this.lanes) this.laneStats.push(lane.pool.getStats());
    return this.profiler.buildReport(this.laneStats);
  }

  /** Neues Messfenster: Effekt- und Lane-Zaehler beginnen gemeinsam bei null. */
  resetProfiling(): void {
    this.profiler.reset();
    for (const lane of this.lanes) lane.pool.resetStats();
  }

  getLaneStats(id: GpuVfxLaneId): GpuVfxPoolStats | null {
    return this.lanes[id]?.pool.getStats() ?? null;
  }

  // ── Interna ────────────────────────────────────────────────────────────────

  /**
   * Der eine Resolver fuer `visible`. Ablation gewinnt immer; danach entscheidet allein, ob die
   * Lane ueberhaupt etwas zu zeigen hat. Geschrieben wird nur bei einem echten Wechsel.
   */
  private applyVisibility(lane: GpuVfxLane): void {
    const want = !this.suppressed && lane.pool.getLiveCount() > 0;
    if (want === lane.visible) return;
    lane.visible = want;
    lane.layer.setVisible(want);
  }

  /**
   * Der `ElapseTimer` eines Layers springt nach `timeElapsedResetPeriod` (eine Stunde) auf null
   * zurueck, ohne die `creationTime` der Member mitzuziehen. Deren Animationen wuerden dann
   * schlagartig weit ueber ihr Ende hinaus extrapolieren – bei ADD ein bildschirmfuellender
   * Blitz, bis der Retire-Sweep nachkommt. Beim Ruecksprung deshalb sofort alles stilllegen.
   */
  private handleTimeWrap(lane: GpuVfxLane): void {
    const timeElapsed = lane.layer.timeElapsed;
    if (timeElapsed < lane.lastTimeElapsed) lane.pool.releaseAll();
    lane.lastTimeElapsed = timeElapsed;
  }
}
