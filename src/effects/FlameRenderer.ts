import * as Phaser from 'phaser';
import { DEPTH, VOID_FIRE_COLOR } from '../config';
import { emissiveAlpha } from './EmissiveScale';
import {
  ensureFlameJetTextures,
  ensureFlameTextures,
  ensureVoidFlameTextures,
  pickHeatTint,
  FLAME_COLORS_SPARK,
  FLAME_JET_TINTS_COOL,
  FLAME_JET_TINTS_HOT,
  FLAME_JET_TINTS_MID,
  TEX_FLAME_GLOW,
  TEX_VOID_FLAME_GLOW,
  VOID_FLAME_COLORS_SPARK,
  VOID_JET_TINTS_COOL,
  VOID_JET_TINTS_HOT,
  VOID_JET_TINTS_MID,
} from './FlameShared';
import { FLAME_LIGHT_ID_STRIDE } from './LightingConfig';
import type { LightingSystem } from './LightingSystem';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

// ── Konfigurations-Konstanten ──────────────────────────────────────────────
const CORE_LIFESPAN  = { min: 120, max: 280 };
const OUTER_LIFESPAN = { min: 200, max: 450 };
const SPARK_LIFESPAN = { min: 100, max: 300 };

const CORE_FREQUENCY_MS  = 16;
const OUTER_FREQUENCY_MS = 20;
const SPARK_FREQUENCY_MS = 50;

/**
 * Laenge der Nachlaufstrecke, ueber die die Spawns *einer* Hitbox verteilt werden – als Zeit,
 * nicht als Pixelwert.
 *
 * Der Flammenwerfer schiesst eine Kette einzelner Hitboxen; bei 70 ms Nachladezeit und 400 px/s
 * liegen an der Duese rund 28 px zwischen zwei Hitboxen, waehrend ihre Partikelwolke dort erst
 * rund 6 px Radius hat. Genau daraus entsteht der Eindruck einzelner Projektile mit Schweif.
 * Wird jeder Spawn stattdessen gleichverteilt hinter den Kopf gelegt, schliesst der Nachlauf
 * jeder Hitbox die Luecke zur naechsten – ohne ein einziges zusaetzliches Partikel.
 *
 * Als Zeit formuliert traegt sich das selbst: Hitboxen und Nachlauf werden durch `velocityDecay`
 * im gleichen Mass langsamer, der Abstand und die Strecke schrumpfen also gemeinsam. Begrenzt
 * wird zusaetzlich durch die tatsaechlich zurueckgelegte Strecke, sonst malte die erste Flamme
 * eines Schusses ihren Nachlauf in den Schuetzen hinein.
 */
const SMEAR_SECONDS = 0.085;

/** Zeit, in der eine Flamme optisch von Weissglut auf Glutrot faellt. */
const HEAT_RAMP_MS = 520;

/** Anteil der Hitbox-Geschwindigkeit, den ein Partikel mitnimmt: der Strahl stroemt weiter. */
const CORE_FORWARD_INHERIT  = 0.42;
const OUTER_FORWARD_INHERIT = 0.28;
const SPARK_FORWARD_INHERIT = 0.5;

/**
 * Restlicher Auftrieb nach oben. Bewusst klein: der fruehere Wert (-40 bis -5 px/s ohne jede
 * Stroemungsrichtung) liess den Strahl unabhaengig von der Zielrichtung nach Norden ziehen und
 * damit wie ein Lagerfeuer statt wie ein gerichteter Jet aussehen.
 */
const CORE_BUOYANCY  = -6;
const OUTER_BUOYANCY = -10;
const SPARK_BUOYANCY = -14;

const DEPTH_FLAME = DEPTH.FIRE;

/** Scratch-Geometrie fuer den richtungslosen Notfall-Spawn; nie im Frame neu angelegt. */
const SPAWN_CIRCLE = new Phaser.Geom.Circle(0, 0, 1);
const SPAWN_POINT = new Phaser.Math.Vector2(0, 0);

/** Ergebnis eines Spawn-Platzes; wiederverwendet, damit der Hotpath nichts allokiert. */
const SPAWN_PLACE = { x: 0, y: 0, heat: 0 };

// ── Interner State pro Flammen-Hitbox ──────────────────────────────────────
interface FlameVisual {
  x: number;
  y: number;
  size: number;
  /** Normierte Flugrichtung; bleibt stehen, wenn die Hitbox fast zum Stillstand kommt. */
  dirX: number;
  dirY: number;
  speed: number;
  /** Seit der Erzeugung zurueckgelegte Strecke – Deckel fuer den Nachlauf. */
  travelPx: number;
  smearPx: number;
  smearMs: number;
  birthMs: number;
  coreFlow: ParticleFlowScheduler;
  outerFlow: ParticleFlowScheduler;
  sparkFlow: ParticleFlowScheduler;
  /** Alle drei Effekte einer Hitbox haengen an dieser Flame-Quelle. */
  source: number;
  hotTints: readonly number[];
  midTints: readonly number[];
  coolTints: readonly number[];
  sparkTints: readonly number[];
  glowImage: Phaser.GameObjects.Image;
  glowBaseAlpha: number;
  isVoid: boolean;
}

/**
 * Rendert Flammenwerfer-Projektile ueber die gemeinsamen GPU-VFX-Lanes.
 *
 * Die Glow-Image- und Lighting-Anteile bleiben CPU-seitig. Die drei kontinuierlichen Partikel-
 * Stroeme teilen sich die szenenweiten SpriteGPULayer, waehrend Countdown und aktueller Spawn-
 * Zustand je FlameVisual erhalten bleiben.
 *
 * ## Warum der Strahl nicht Hitbox fuer Hitbox gezeichnet wird
 *
 * Die Netzlast deckelt die Zahl der Flammen-Hitboxen; sichtbar bleiben soll trotzdem *ein*
 * Strahl. Drei Eigenschaften tragen das, alle ohne zusaetzliche Partikel:
 *
 * 1. **Nachlauf** (`SMEAR_SECONDS`): Spawns liegen gleichverteilt hinter dem Kopf und schliessen
 *    die Luecke zur nachfolgenden Hitbox.
 * 2. **Stroemung**: jedes Partikel erbt einen Teil der Hitbox-Geschwindigkeit und streut nur
 *    quer dazu. Der Strahl zeigt damit dorthin, wohin gezielt wird.
 * 3. **Temperaturverlauf** (`HEAT_RAMP_MS`): der Tint haengt am Alter der Flamme an der Stelle,
 *    an der das Partikel entsteht – weissgelb an der Duese, glutrot am Ende.
 */
export class FlameRenderer {
  private readonly scene: Phaser.Scene;
  private readonly flames = new Map<number, FlameVisual>();
  /** Parallel zur Map, damit der GPU-Emissionstick ohne Iterator-Allokation laeuft. */
  private readonly activeFlames: FlameVisual[] = [];
  private lighting: LightingSystem | null = null;

  private gpuVfx: GpuVfxSystem | null = null;
  private coreSpec: GpuVfxSpawnSpec | null = null;
  private outerSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  // ── Texturen ──────────────────────────────────────────────────────────────

  /** Erzeugt alle benoetigten Flame-Texturen prozedural (idempotent pro Scene). */
  generateTextures(): void {
    ensureFlameTextures(this.scene);
    ensureVoidFlameTextures(this.scene);
    ensureFlameJetTextures(this.scene);
  }

  /** Meldet die drei Flame-Effekte beim szenenweiten GPUFX-Backend an. */
  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;

    this.coreSpec = system.createSpec(GpuVfxEffectId.FlameCore);
    this.coreSpec.frame = GpuVfxFrameId.FlameTongue;
    this.coreSpec.scaleEase = GpuVfxEase.QuadOut;
    this.coreSpec.alphaStart = 0.72;
    this.coreSpec.alphaEnd = 0;

    this.outerSpec = system.createSpec(GpuVfxEffectId.FlameOuter);
    this.outerSpec.frame = GpuVfxFrameId.FlameBillow;
    this.outerSpec.scaleEase = GpuVfxEase.QuadOut;
    this.outerSpec.alphaStart = 0.44;
    this.outerSpec.alphaEnd = 0;

    this.sparkSpec = system.createSpec(GpuVfxEffectId.FlameSpark);
    this.sparkSpec.scaleStart = 0.6;
    this.sparkSpec.scaleEnd = 0.1;
    this.sparkSpec.alphaStart = 1;
    this.sparkSpec.alphaEnd = 0;
    this.sparkSpec.yMode = GpuVfxEase.Gravity;

    system.registerEmission((deltaMs, nowMs) => this.emitParticles(deltaMs, nowMs));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Registriert eine neue Flammen-Hitbox fuer die visuelle Darstellung. */
  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.flames.has(id)) return;

    const isVoid = color === VOID_FIRE_COLOR;
    const glowBaseAlpha = isVoid ? 0.82 : 0.55;

    // Glow: additiver Leucht-Halo der mit der Hitbox waechst.
    const glowImage = this.scene.add.image(
      x,
      y,
      isVoid ? TEX_VOID_FLAME_GLOW : TEX_FLAME_GLOW,
    );
    glowImage.setBlendMode(Phaser.BlendModes.ADD);
    glowImage.setDepth(DEPTH_FLAME - 0.1);
    glowImage.setAlpha(emissiveAlpha(glowBaseAlpha));
    glowImage.setScale(glowScale(size));
    glowImage.setTint(isVoid ? VOID_FIRE_COLOR : 0xffaa44);

    const visual: FlameVisual = {
      x,
      y,
      size,
      dirX: 0,
      dirY: 0,
      speed: 0,
      travelPx: 0,
      smearPx: 0,
      smearMs: 0,
      birthMs: this.gpuVfx?.now() ?? 0,
      coreFlow: new ParticleFlowScheduler(CORE_FREQUENCY_MS),
      outerFlow: new ParticleFlowScheduler(OUTER_FREQUENCY_MS),
      sparkFlow: new ParticleFlowScheduler(SPARK_FREQUENCY_MS),
      source: this.gpuVfx?.createSource(GpuVfxEffectId.FlameCore) ?? GPU_VFX_NO_SOURCE_HANDLE,
      hotTints: isVoid ? VOID_JET_TINTS_HOT : FLAME_JET_TINTS_HOT,
      midTints: isVoid ? VOID_JET_TINTS_MID : FLAME_JET_TINTS_MID,
      coolTints: isVoid ? VOID_JET_TINTS_COOL : FLAME_JET_TINTS_COOL,
      sparkTints: isVoid ? VOID_FLAME_COLORS_SPARK : FLAME_COLORS_SPARK,
      glowImage,
      glowBaseAlpha,
      isVoid,
    };

    this.flames.set(id, visual);
    this.activeFlames.push(visual);
  }

  /** Aktualisiert Position, Groesse und Richtung einer Flammen-Hitbox. */
  updateVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    vx: number,
    vy: number,
  ): void {
    const visual = this.flames.get(id);
    if (!visual) return;

    // Bereits gespawnte GPU-Member werden nicht editiert; nur der naechste Spawn nimmt den
    // aktuellen Hitbox-Zustand auf.
    visual.travelPx += Math.hypot(x - visual.x, y - visual.y);
    visual.x = x;
    visual.y = y;
    visual.size = size;

    const speed = Math.hypot(vx, vy);
    visual.speed = speed;
    if (speed > 0.001) {
      // Die Richtung bleibt sonst stehen: eine fast ausgebremste Flamme soll ihren Strahl
      // weiter entlang der Schussachse zeichnen, nicht entlang von Rundungsrauschen.
      visual.dirX = vx / speed;
      visual.dirY = vy / speed;
    }
    visual.smearPx = Math.min(visual.travelPx, speed * SMEAR_SECONDS);
    visual.smearMs = speed > 0.001 ? (visual.smearPx / speed) * 1000 : 0;

    visual.glowImage.setPosition(x, y);
    visual.glowImage.setScale(glowScale(size));

    // Nur jede n-te Hitbox traegt Licht – sonst ueberstrahlt ein einzelner Strahl das gesamte
    // Frame-Budget. Freigabe laeuft ueber destroyVisual().
    if (id % FLAME_LIGHT_ID_STRIDE === 0) {
      this.lighting?.setLight(`flame:${id}`, visual.isVoid ? 'voidFlameProjectile' : 'flameProjectile', x, y, {
        radiusPx: visual.isVoid ? 96 + size * 2.55 : 80 + size * 2.2,
      });
    }
  }

  /** Entfernt eine Flammen-Hitbox-Visualisierung und nur deren GPUFX-Quelle. */
  destroyVisual(id: number): void {
    this.lighting?.releaseLight(`flame:${id}`);
    const visual = this.flames.get(id);
    if (!visual) return;

    this.gpuVfx?.releaseSource(visual.source);
    visual.glowImage.destroy();

    const index = this.activeFlames.indexOf(visual);
    if (index >= 0) this.activeFlames.splice(index, 1);
    this.flames.delete(id);
  }

  /** Prueft ob eine Flammen-Visualisierung existiert. */
  has(id: number): boolean {
    return this.flames.has(id);
  }

  /** Gibt alle aktiven Flammen-IDs zurueck (fuer Orphan-Cleanup). */
  getActiveIds(): number[] {
    return [...this.flames.keys()];
  }

  /** Entfernt alle Flammen-Visualisierungen und laesst andere GPUFX-Effekte unangetastet. */
  destroyAll(): void {
    for (const [id] of this.flames) this.destroyVisual(id);
  }

  // ── GPU-Emission ──────────────────────────────────────────────────────────

  /** Vom GpuVfxSystem pro Renderframe nach dem Retire-Sweep gerufen. */
  private emitParticles(deltaMs: number, nowMs: number): void {
    const system = this.gpuVfx;
    const coreSpec = this.coreSpec;
    const outerSpec = this.outerSpec;
    const sparkSpec = this.sparkSpec;
    if (!system || !coreSpec || !outerSpec || !sparkSpec) return;

    const coreFrequency = system.quality.scaleFrequency(CORE_FREQUENCY_MS, GpuVfxEffectId.FlameCore);
    const outerFrequency = system.quality.scaleFrequency(OUTER_FREQUENCY_MS, GpuVfxEffectId.FlameOuter);
    const sparkFrequency = system.quality.scaleFrequency(SPARK_FREQUENCY_MS, GpuVfxEffectId.FlameSpark);

    for (let index = 0; index < this.activeFlames.length; index += 1) {
      const visual = this.activeFlames[index];
      const ageMs = nowMs - visual.birthMs;

      // Der Halo folgt der Temperatur: an der Duese traegt er den Strahl, am ausbrennenden Ende
      // wuerde er als eigenstaendige Scheibe wieder die einzelne Hitbox verraten.
      visual.glowImage.setAlpha(emissiveAlpha(visual.glowBaseAlpha * (0.3 + 0.7 * heatOf(ageMs))));

      if (coreFrequency > 0) {
        visual.coreFlow.setFrequency(coreFrequency);
        const due = visual.coreFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) {
          this.spawnCore(visual, coreSpec, nowMs, ageMs);
          this.spawnCore(visual, coreSpec, nowMs, ageMs);
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.FlameCore);
      }

      if (outerFrequency > 0) {
        visual.outerFlow.setFrequency(outerFrequency);
        const due = visual.outerFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) {
          this.spawnOuter(visual, outerSpec, nowMs, ageMs);
          this.spawnOuter(visual, outerSpec, nowMs, ageMs);
        }
      } else {
        system.recordQualityDrop(GpuVfxEffectId.FlameOuter);
      }

      if (sparkFrequency > 0) {
        visual.sparkFlow.setFrequency(sparkFrequency);
        const due = visual.sparkFlow.tick(deltaMs);
        for (let n = 0; n < due; n += 1) this.spawnSpark(visual, sparkSpec, nowMs, ageMs);
      } else {
        system.recordQualityDrop(GpuVfxEffectId.FlameSpark);
      }
    }
  }

  private spawnCore(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number, ageMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    const place = this.placeSpawn(visual, ageMs, Math.max(visual.size * 0.16, 2.5));
    const advect = visual.speed * CORE_FORWARD_INHERIT;
    const lateral = spreadFactor() * (14 + visual.size * 0.22);
    const length = 10 + visual.size * 0.35;

    spec.frame = GpuVfxFrameId.FlameTongue;
    spec.lifeMs = Phaser.Math.FloatBetween(CORE_LIFESPAN.min, CORE_LIFESPAN.max);
    spec.x = place.x;
    spec.y = place.y;
    spec.vx = visual.dirX * advect - visual.dirY * lateral;
    spec.vy = visual.dirY * advect + visual.dirX * lateral + CORE_BUOYANCY;
    // Die Zunge liegt in der Stroemung; der kleine Winkelfehler haelt den Strahl unruhig.
    spec.rotation = Math.atan2(spec.vy, spec.vx) + Phaser.Math.FloatBetween(-0.18, 0.18);
    spec.angularVelocity = Phaser.Math.FloatBetween(-0.6, 0.6);
    spec.scaleStart = length / 32;
    spec.scaleEnd = spec.scaleStart * 1.3;
    spec.tint = pickHeatTint(visual.hotTints, visual.midTints, visual.coolTints, place.heat * 0.55 + 0.45);
    system.spawn(spec, visual.source, nowMs);
  }

  private spawnOuter(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number, ageMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    const place = this.placeSpawn(visual, ageMs, Math.max(visual.size * 0.34, 4));
    const advect = visual.speed * OUTER_FORWARD_INHERIT;
    const lateral = spreadFactor() * (20 + visual.size * 0.35);
    const diameter = 12 + visual.size * 0.42;

    spec.frame = GpuVfxFrameId.FlameBillow;
    spec.lifeMs = Phaser.Math.FloatBetween(OUTER_LIFESPAN.min, OUTER_LIFESPAN.max);
    spec.x = place.x;
    spec.y = place.y;
    spec.vx = visual.dirX * advect - visual.dirY * lateral;
    spec.vy = visual.dirY * advect + visual.dirX * lateral + OUTER_BUOYANCY;
    spec.rotation = Phaser.Math.FloatBetween(0, Math.PI * 2);
    spec.angularVelocity = Phaser.Math.FloatBetween(-1.4, 1.4);
    spec.scaleStart = diameter / 32;
    // Ein Gasballen dehnt sich beim Abkuehlen aus. Der fruehere Verlauf auf 0.05 liess ihn
    // stattdessen zu einem Punkt schrumpfen – die Lesart "Funke mit Schweif".
    spec.scaleEnd = spec.scaleStart * 1.45;
    spec.tint = pickHeatTint(visual.hotTints, visual.midTints, visual.coolTints, place.heat);
    system.spawn(spec, visual.source, nowMs);
  }

  private spawnSpark(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number, ageMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    const place = this.placeSpawn(visual, ageMs, Math.max(visual.size * 0.24, 3));
    const advect = visual.speed * SPARK_FORWARD_INHERIT;
    const lateral = spreadFactor() * (30 + visual.size * 0.3);

    spec.frame = visual.isVoid ? GpuVfxFrameId.FlameSparkVoid : GpuVfxFrameId.FlameSpark;
    spec.lifeMs = Phaser.Math.FloatBetween(SPARK_LIFESPAN.min, SPARK_LIFESPAN.max);
    spec.x = place.x;
    spec.y = place.y;
    spec.vx = visual.dirX * advect - visual.dirY * lateral;
    spec.vy = visual.dirY * advect + visual.dirX * lateral + SPARK_BUOYANCY;
    spec.rotation = 0;
    spec.angularVelocity = 0;
    spec.tint = pickGpuVfxTint(visual.sparkTints);
    system.spawn(spec, visual.source, nowMs);
  }

  /**
   * Legt einen Spawn irgendwo auf der Nachlaufstrecke ab und liefert die dort gueltige Hitze.
   *
   * Die Streuung quer zur Flugrichtung ist dreiecksverteilt: gleichverteilte Punkte in einem
   * Kreis lassen den Strahl an den Raendern ebenso dicht wirken wie in der Mitte und nehmen ihm
   * die Kernhelligkeit. Weiter hinten liegende Punkte gehoeren zu einer *juengeren* Stelle des
   * Strahls – dort war die Hitbox noch schmaler und heisser.
   */
  private placeSpawn(visual: FlameVisual, ageMs: number, lateralRadius: number): typeof SPAWN_PLACE {
    if (visual.speed <= 0.001) {
      SPAWN_CIRCLE.setTo(visual.x, visual.y, lateralRadius);
      Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);
      SPAWN_PLACE.x = SPAWN_POINT.x;
      SPAWN_PLACE.y = SPAWN_POINT.y;
      SPAWN_PLACE.heat = heatOf(ageMs);
      return SPAWN_PLACE;
    }

    const along = Math.random();
    const back = visual.smearPx * along;
    const radius = lateralRadius * (1 - 0.3 * along);
    const lateral = spreadFactor() * radius;
    const jitter = (Math.random() - 0.5) * radius * 0.8;

    SPAWN_PLACE.x = visual.x - visual.dirX * (back - jitter) - visual.dirY * lateral;
    SPAWN_PLACE.y = visual.y - visual.dirY * (back - jitter) + visual.dirX * lateral;
    SPAWN_PLACE.heat = heatOf(ageMs - visual.smearMs * along);
    return SPAWN_PLACE;
  }
}

/** Resthitze einer Flamme: 1 an der Duese, 0 am ausgebrannten Ende. */
function heatOf(ageMs: number): number {
  if (ageMs <= 0) return 1;
  if (ageMs >= HEAT_RAMP_MS) return 0;
  return 1 - ageMs / HEAT_RAMP_MS;
}

/** Dreiecksverteilt in [-1, 1]: dicht in der Mitte, ausgeduennt zum Rand. */
function spreadFactor(): number {
  return Math.random() + Math.random() - 1;
}

function glowScale(size: number): number {
  return Math.max(size / 48 * 2.1, 0.5);
}
