import * as Phaser from 'phaser';
import { GpuVfxPool, type GpuVfxPoolStats } from './GpuVfxPool';

/**
 * GpuVfxRegistry – gemeinsame Klammer um alle `SpriteGPULayer`-Partikeleffekte einer Szene.
 *
 * Jeder Effekt bringt nur noch sein eigenes Spawn-Verhalten mit. Alles, was fuer jeden Effekt
 * gleich ist, liegt hier genau einmal:
 *
 * - Anlegen, Primen und Konfigurieren der Layer (Blend, Depth, Ease-Vorwaermung),
 * - eine gemeinsame monotone Partikeluhr,
 * - der Ruecksprung von `layer.timeElapsed` (siehe `handleTimeWrap`),
 * - der Retire-Sweep vor jeder Emission,
 * - der Ablations-Schalter und die Diagnose-Statistik ueber alle Layer.
 *
 * Die Reihenfolge in `update()` ist Teil des Vertrags: erst stilllegen, dann emittieren. Der
 * Pool vergibt ausschliesslich freie Slots, ein Spawn vor dem Sweep wuerde sonst unnoetig als
 * Overrun abgewiesen. Effekte melden ihren Emissions-Tick deshalb hier an, statt selbst pro
 * Frame aufgerufen zu werden.
 */

/** Ein GPU-Layer samt zugehoerigem Ringbuffer. */
export interface GpuVfxEmitter {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  readonly pool: GpuVfxPool;
}

export interface GpuVfxEmitterOptions {
  /** Erscheint in der Diagnose und in Overrun-Warnungen. */
  readonly name: string;
  readonly texture: string;
  readonly capacity: number;
  readonly depth: number;
  /**
   * Alle Ease-Typen, die dieser Effekt spaeter benutzt. Ein erstmals auftauchender Typ laesst
   * Shader und FrameData neu bauen; hier vorgewaermt passiert das nie im Spielverlauf. Die
   * Namen muessen exakt die aus Phasers Rueckwaertsabbildung `EASE_CODES` sein – mehrere
   * Aliase teilen sich einen Code (`Power0` und `Linear` beide 1).
   */
  readonly eases: readonly string[];
  /** Default `ADD`. Effekte, die der klassische Emitter ungedaempft gezeichnet hat, brauchen `NORMAL`. */
  readonly blendMode?: number;
  /** Nur fuer `ease: 'Gravity'`: Beschleunigung in px/s². */
  readonly gravity?: number;
}

/** Wird pro Renderframe gerufen, nachdem abgelaufene Member stillgelegt wurden. */
export type GpuVfxEmissionTick = (deltaMs: number, nowMs: number) => void;

export type GpuVfxMember          = Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member>;
export type GpuVfxMemberAnimation = Phaser.Types.GameObjects.SpriteGPULayer.MemberAnimation;

/** Gleiche Auswahl wie Phasers `EmitterOp.randomStaticValueEmit` fuer Tint-Arrays. */
export function pickGpuVfxTint(tints: readonly number[]): number {
  return tints[Math.floor(Math.random() * tints.length)];
}

/**
 * Basiswert fuer eine **nicht-lineare** Ease mit `loop: false`.
 *
 * Der Shader addiert dort ueber die gesamte Laufzeit `floor(amplitude) * amplitude`
 * (`SpriteGPULayer.vert`: `repeats = loop ? 0.0 : floor(a)`). Der Term ist fuer die
 * Frame-Index-Animation gedacht, wo `amplitude` die Anzahl der Frames ist, und stoert bei
 * jeder anderen Groesse. Bei negativen Amplituden greift `floor` bereits ab -1: eine
 * Alpha-Kurve 0.95 → 0 kaeme ohne Korrektur als 1.9 → 0.95 heraus.
 *
 * Diese Funktion nimmt den Term vorweg, sodass am Ende exakt `base + amplitude * ease(t)`
 * herauskommt – unabhaengig vom Betrag der Amplitude. Lineare Animationen brauchen sie nicht:
 * `Linear` rechnet mit `timeContinuous` und ohne `repeats`.
 */
export function gpuVfxEasedBase(base: number, amplitude: number): number {
  return base - Math.floor(amplitude) * amplitude;
}

/**
 * Setzt alle vier Ecken auf denselben Tint. Zusammen mit `tintBlend: 1` und dem Default
 * `tintMode: 0` entspricht das dem Multiply-Tint eines klassischen Partikels.
 */
export function setGpuVfxTint(member: GpuVfxMember, tint: number): void {
  member.tintTopLeft     = tint;
  member.tintTopRight    = tint;
  member.tintBottomLeft  = tint;
  member.tintBottomRight = tint;
}

/**
 * Geteilte Layer entstehen beim Szenenaufbau, die bisherigen Emitter entstanden zur Laufzeit
 * und lagen bei gleicher Depth deshalb ueber Spielern, Felsen und Projektilkoerpern. Dieser
 * Versatz haelt die Reihenfolge, ohne ein bestehendes Tiefenband zu verlassen: er ist deutlich
 * kleiner als der kleinste vorhandene Abstand (DEPTH.ROCKS 9 → DEPTH.ROCK_MOSS 9.08).
 */
export const GPU_VFX_DEPTH_EPSILON = 0.001;

/** Ruhepose: flaechenlos und unsichtbar, bis der Slot bespielt wird. */
const DEAD_MEMBER: Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member> = {
  scaleX: 0,
  scaleY: 0,
  alpha: 0,
};

interface RegisteredEmitter extends GpuVfxEmitter {
  readonly name: string;
  lastTimeElapsed: number;
}

export class GpuVfxRegistry {
  private readonly emitters: RegisteredEmitter[] = [];
  private readonly ticks: GpuVfxEmissionTick[] = [];
  /** Gemeinsame monotone Uhr fuer Slot-Lebenszeiten, gleich getaktet mit den GPU-Animationen. */
  private clockMs = 0;
  private suppressed = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Legt einen geteilten Layer an – einmalig, szenenlebenslang, niemals pro Effektinstanz.
   * Der Pool ist danach vollstaendig gefuellt und sofort bespielbar.
   */
  createEmitter(options: GpuVfxEmitterOptions): GpuVfxEmitter {
    const layer = this.scene.add.spriteGPULayer(options.texture, options.capacity);
    layer.setBlendMode(options.blendMode ?? Phaser.BlendModes.ADD);
    layer.setDepth(options.depth);
    if (options.gravity !== undefined) layer.gravity = options.gravity;
    for (const ease of options.eases) layer.setAnimationEnabled(ease, true);

    const pool = new GpuVfxPool(layer, options.capacity, options.name);
    pool.prime(DEAD_MEMBER);

    const registered: RegisteredEmitter = {
      name: options.name,
      layer,
      pool,
      lastTimeElapsed: layer.timeElapsed,
    };
    this.emitters.push(registered);
    return registered;
  }

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

    for (let index = 0; index < this.emitters.length; index += 1) {
      const emitter = this.emitters[index];
      this.handleTimeWrap(emitter);
      emitter.pool.retireExpired(this.clockMs);
    }

    // Waehrend der Ablation ruhen Rendering *und* Scheduler. Die Flow-Countdowns der Effekte
    // bleiben unangetastet, damit beim Segmentende nichts nachgeholt wird.
    if (this.suppressed) return;

    for (let index = 0; index < this.ticks.length; index += 1) {
      this.ticks[index](deltaMs, this.clockMs);
    }
  }

  /**
   * Ablations-Hook. GPU-Zeit laesst sich nicht anhalten, deshalb ist das Stilllegen der
   * laufenden Member das Aequivalent zum `setActive(false)` der klassischen Emitter.
   */
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    for (const emitter of this.emitters) {
      emitter.layer.setVisible(!suppressed);
      if (suppressed) emitter.pool.releaseAll();
    }
  }

  /**
   * Leichtgewichtige Diagnose. Der `ArenaRuntimeProfiler` zaehlt weiterhin nur klassische
   * `ParticleEmitter`; GPU-Member tauchen dort naturgemaess nicht auf.
   */
  getStats(): Record<string, GpuVfxPoolStats> | null {
    if (this.emitters.length === 0) return null;
    const stats: Record<string, GpuVfxPoolStats> = {};
    for (const emitter of this.emitters) stats[emitter.name] = emitter.pool.getStats();
    return stats;
  }

  releaseAll(): void {
    for (const emitter of this.emitters) emitter.pool.releaseAll();
  }

  /**
   * Der `ElapseTimer` eines Layers springt nach `timeElapsedResetPeriod` (eine Stunde) auf null
   * zurueck, ohne die `creationTime` der Member mitzuziehen. Deren Animationen wuerden dann
   * schlagartig weit ueber ihr Ende hinaus extrapolieren – bei ADD ein bildschirmfuellender
   * Blitz, bis der Retire-Sweep nachkommt. Beim Ruecksprung deshalb sofort alles stilllegen;
   * das kostet einmal pro Stunde ein paar hundert ohnehin kurzlebige Partikel.
   */
  private handleTimeWrap(emitter: RegisteredEmitter): void {
    const timeElapsed = emitter.layer.timeElapsed;
    if (timeElapsed < emitter.lastTimeElapsed) emitter.pool.releaseAll();
    emitter.lastTimeElapsed = timeElapsed;
  }
}
