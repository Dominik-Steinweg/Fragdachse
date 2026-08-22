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
const OUTER_FREQUENCY_MS = 17;
const SPARK_FREQUENCY_MS = 50;

/**
 * Laenge des Nachlaufs hinter dem Kopf einer Hitbox – als Zeit, nicht als Pixelwert.
 *
 * Sie deckt das Stueck zwischen Duese und juengster Hitbox ab, das noch keine nachfolgende
 * Flamme hat. Als Zeit formuliert traegt sie sich selbst: `velocityDecay` verlangsamt Abstand
 * und Nachlauf im gleichen Mass. Zusaetzlich begrenzt die tatsaechlich zurueckgelegte Strecke,
 * sonst malte die erste Flamme eines Schusses ihren Nachlauf in den Schuetzen hinein.
 */
const SMEAR_SECONDS = 0.085;

/**
 * Verkettung: beim Anlegen darf eine Hitbox hoechstens so weit von ihrem Vorgaenger entfernt
 * sein. Der Duesenabstand betraegt Feuerrate x Muendungsgeschwindigkeit (rund 28 px beim
 * Flammenwerfer); der Wert laesst Bewegung und Zielrichtungswechsel zu, verhindert aber, dass
 * zwei Quellen desselben Besitzers (zwei Tuerme) miteinander verkettet werden.
 */
const CHAIN_LINK_MAX_PX = 76;

/**
 * Beim Emittieren: reisst die Kette weiter auf (Feuerpause, blockierte Flamme, Teleport), wird
 * die Bruecke verworfen und der Nachlauf uebernimmt wieder. Grosszuegiger als
 * `CHAIN_LINK_MAX_PX`, weil zwei verkettete Hitboxen beim Schwenken auseinanderlaufen duerfen –
 * genau dieses Auffaechern soll als Feuerfahne gefuellt werden.
 */
const BRIDGE_MAX_PX = 150;

/** Wie viele juengste Hitboxen je Besitzer als Verkettungskandidaten gepruefte werden. */
const CHAIN_RECENT_PER_OWNER = 4;

/** Zeit, in der eine Flamme optisch von Weissglut auf Glutrot faellt. */
const HEAT_RAMP_MS = 520;

/** Anteil der Hitbox-Geschwindigkeit, den ein Partikel mitnimmt: der Strahl stroemt weiter. */
const CORE_FORWARD_INHERIT  = 0.42;
const OUTER_FORWARD_INHERIT = 0.28;
const SPARK_FORWARD_INHERIT = 0.5;

/**
 * Restlicher Auftrieb nach oben. Bewusst klein: ein richtungsloser Drift nach Norden laesst den
 * Strahl unabhaengig von der Zielrichtung wie ein Lagerfeuer aussehen.
 */
const CORE_BUOYANCY  = -6;
const OUTER_BUOYANCY = -10;
const SPARK_BUOYANCY = -14;

/**
 * Querstreuung als Anteil der Hitbox-Groesse. Die Hitbox ist die Wahrheit: ihr Radius ist
 * `size * 0.5`, und die Huelle darf ihn ausschoepfen. Sie ist der Grund, warum benachbarte
 * Bahnen einer aufgefaecherten Salve ueberhaupt ineinanderlaufen.
 */
const CORE_LATERAL_FRACTION  = 0.3;
const OUTER_LATERAL_FRACTION = 0.5;
const SPARK_LATERAL_FRACTION = 0.34;

const DEPTH_FLAME = DEPTH.FIRE;

/** Ergebnis einer Spawn-Platzierung; wiederverwendet, damit der Hotpath nichts allokiert. */
const SPAWN_PLACE = { x: 0, y: 0, heat: 0, size: 0, dirX: 0, dirY: 0 };

// ── Interner State pro Flammen-Hitbox ──────────────────────────────────────
interface FlameVisual {
  id: number;
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
  /** Kettenschluessel (Turm- bzw. Spieler-Id) und die Hitbox, die vor dieser abgefeuert wurde. */
  chainKey: string;
  predecessorId: number;
  /** Eine Hitbox ist Vorgaenger genau einer anderen; sonst bliebe eine Luecke unbedeckt. */
  claimed: boolean;
  /** Je Frame aufgeloeste Bruecke zum Vorgaenger; Laenge 0 heisst "kein Vorgaenger". */
  bridgeX: number;
  bridgeY: number;
  bridgeLen: number;
  bridgeSize: number;
  bridgeBirthMs: number;
  bridgeDirX: number;
  bridgeDirY: number;
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
 * ## Der Strahl ist die Kette, nicht die einzelne Hitbox
 *
 * Netzseitig ist der Flammenwerfer eine Folge einzelner Projektile, und die liegen weder
 * aufeinander noch auf einer Linie: Streuung, Spielerbewegung und Zielrichtungswechsel
 * faechern sie auf. Wer jede Hitbox fuer sich zeichnet – egal wie dicht – bekommt deshalb
 * parallele Einzelbahnen mit Luecken dazwischen.
 *
 * Jede Hitbox kennt darum ihren *Vorgaenger* (die vorher abgefeuerte Hitbox derselben Quelle)
 * und emittiert gleichverteilt auf der Strecke `[-Nachlauf, Bruecke zum Vorgaenger]`. Diese
 * Strecke ist die tatsaechliche Verbindung zweier Kettenglieder; sie deckt Auffaechern,
 * Strafen und Schwenks gleichermassen ab, weil sie aus den echten Positionen entsteht statt
 * aus einer Annahme ueber die Schussachse. Groesse, Alter und Flugrichtung werden entlang der
 * Bruecke interpoliert, sodass Breite und Farbe stetig ineinander laufen.
 *
 * Der Kopf der Kette (aeltestes lebendes Glied) und der erste Schuss einer Salve haben keinen
 * Vorgaenger und fallen auf den reinen Nachlauf zurueck.
 */
export class FlameRenderer {
  private readonly scene: Phaser.Scene;
  private readonly flames = new Map<number, FlameVisual>();
  /** Parallel zur Map, damit der GPU-Emissionstick ohne Iterator-Allokation laeuft. */
  private readonly activeFlames: FlameVisual[] = [];
  /** Je Kettenschluessel die juengsten Hitbox-Ids, neueste zuerst. */
  private readonly recentByChain = new Map<string, number[]>();
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
    this.coreSpec.alphaStart = 0.58;
    this.coreSpec.alphaEnd = 0;
    // Ein Hauch Weissglut beim Zuenden, danach die volle Bandfarbe. Bewusst nur ein Hauch:
    // additiv hebt jeder entsaettigte Beitrag alle drei Kanaele an, und der Strahl kippt als
    // Ganzes ins Weisse, statt gelb-orange zu lesen.
    this.coreSpec.tintBlendStart = 0.62;
    this.coreSpec.tintBlendEnd = 1;

    this.outerSpec = system.createSpec(GpuVfxEffectId.FlameOuter);
    this.outerSpec.frame = GpuVfxFrameId.FlameBillow;
    this.outerSpec.scaleEase = GpuVfxEase.QuadOut;
    this.outerSpec.alphaStart = 0.4;
    this.outerSpec.alphaEnd = 0;
    // Die Huelle deckt die groesste Flaeche ab und traegt deshalb praktisch keine Entsaettigung.
    this.outerSpec.tintBlendStart = 0.9;
    this.outerSpec.tintBlendEnd = 1;

    this.sparkSpec = system.createSpec(GpuVfxEffectId.FlameSpark);
    this.sparkSpec.scaleStart = 0.6;
    this.sparkSpec.scaleEnd = 0.1;
    this.sparkSpec.alphaStart = 1;
    this.sparkSpec.alphaEnd = 0;
    this.sparkSpec.yMode = GpuVfxEase.Gravity;

    system.registerEmission((deltaMs, nowMs) => this.emitParticles(deltaMs, nowMs));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Registriert eine neue Flammen-Hitbox fuer die visuelle Darstellung.
   *
   * `chainKey` benennt die Quelle des Strahls (Turm- oder Spieler-Id). Ohne ihn bleibt die
   * Hitbox unverkettet und zeichnet nur ihren eigenen Nachlauf.
   */
  createVisual(id: number, x: number, y: number, size: number, color: number, chainKey = ''): void {
    if (this.flames.has(id)) return;

    const isVoid = color === VOID_FIRE_COLOR;
    // Der Halo ist eine breite additive Flaeche unter dem ganzen Strahl; er hebt den Untergrund
    // gleichmaessig an und ist damit der zweite Weg, auf dem die Flamme ins Weisse kippt.
    const glowBaseAlpha = isVoid ? 0.64 : 0.4;

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
      id,
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
      chainKey,
      predecessorId: this.linkPredecessor(chainKey, x, y),
      claimed: false,
      bridgeX: 0,
      bridgeY: 0,
      bridgeLen: 0,
      bridgeSize: size,
      bridgeBirthMs: 0,
      bridgeDirX: 0,
      bridgeDirY: 0,
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
    if (chainKey !== '') this.pushRecent(chainKey, id);
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

    const preset = visual.isVoid ? 'voidFlameProjectile' : 'flameProjectile';

    // Nur jede n-te Hitbox traegt Licht – sonst ueberstrahlt ein einzelner Strahl das gesamte
    // Frame-Budget. Freigabe laeuft ueber destroyVisual().
    if (id % FLAME_LIGHT_ID_STRIDE === 0) {
      this.lighting?.setLight(`flame:${id}`, preset, x, y, {
        radiusPx: visual.isVoid ? 96 + size * 2.55 : 80 + size * 2.2,
      });
    }

    // Die Wurzel des Strahls ist sein hellster Punkt und darf nicht davon abhaengen, ob gerade
    // eine passende Id faellt. Das Licht haengt am Kettenschluessel, nicht an der Hitbox: es
    // wandert dadurch mit der Duese weiter, statt beim Weiterruecken der Kette zu springen.
    if (visual.chainKey !== '' && this.recentByChain.get(visual.chainKey)?.[0] === id) {
      this.lighting?.setLight(`flameMuzzle:${visual.chainKey}`, preset, x, y, {
        radiusPx: visual.isVoid ? 172 : 150,
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
    this.dropRecent(visual.chainKey, id);

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
    // `destroyVisual` raeumt jede Kette einzeln ab; der Rest faengt Ketten ohne Hitbox ab.
    for (const chainKey of this.recentByChain.keys()) {
      this.lighting?.releaseLight(`flameMuzzle:${chainKey}`);
    }
    this.recentByChain.clear();
  }

  // ── Verkettung ────────────────────────────────────────────────────────────

  /**
   * Sucht den Vorgaenger einer neu entstehenden Hitbox.
   *
   * Gepruefte werden die juengsten Hitboxen derselben Quelle, neueste zuerst. Ein Kandidat
   * scheidet aus, wenn er zu weit weg ist (zwei Tuerme desselben Besitzers, Feuerpause) oder
   * bereits Vorgaenger einer anderen Hitbox ist – sonst blieb dessen Luecke ungefuellt und eine
   * andere doppelt belegt.
   */
  private linkPredecessor(chainKey: string, x: number, y: number): number {
    if (chainKey === '') return -1;
    const recent = this.recentByChain.get(chainKey);
    if (!recent) return -1;

    for (let index = 0; index < recent.length; index += 1) {
      const candidate = this.flames.get(recent[index]);
      if (!candidate || candidate.claimed) continue;
      if (Math.hypot(candidate.x - x, candidate.y - y) > CHAIN_LINK_MAX_PX) continue;
      candidate.claimed = true;
      return candidate.id;
    }
    return -1;
  }

  private pushRecent(chainKey: string, id: number): void {
    let recent = this.recentByChain.get(chainKey);
    if (!recent) {
      recent = [];
      this.recentByChain.set(chainKey, recent);
    }
    recent.unshift(id);
    if (recent.length > CHAIN_RECENT_PER_OWNER) recent.length = CHAIN_RECENT_PER_OWNER;
  }

  private dropRecent(chainKey: string, id: number): void {
    const recent = this.recentByChain.get(chainKey);
    if (!recent) return;
    const index = recent.indexOf(id);
    if (index >= 0) recent.splice(index, 1);
    if (recent.length > 0) return;
    // Mit dem letzten Kettenglied verschwindet auch das Muendungslicht dieser Quelle.
    this.recentByChain.delete(chainKey);
    this.lighting?.releaseLight(`flameMuzzle:${chainKey}`);
  }

  /** Loest die Bruecke zum Vorgaenger fuer dieses Frame auf. */
  private resolveBridge(visual: FlameVisual): void {
    visual.bridgeLen = 0;
    if (visual.predecessorId < 0) return;

    const predecessor = this.flames.get(visual.predecessorId);
    if (!predecessor) return;

    const bridgeX = predecessor.x - visual.x;
    const bridgeY = predecessor.y - visual.y;
    const length = Math.hypot(bridgeX, bridgeY);
    if (length < 0.001 || length > BRIDGE_MAX_PX) return;

    visual.bridgeX = bridgeX;
    visual.bridgeY = bridgeY;
    visual.bridgeLen = length;
    visual.bridgeSize = predecessor.size;
    visual.bridgeBirthMs = predecessor.birthMs;
    visual.bridgeDirX = predecessor.dirX;
    visual.bridgeDirY = predecessor.dirY;
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
      this.resolveBridge(visual);
      this.updateGlow(visual, ageMs);

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

  /**
   * Der Halo folgt Temperatur *und* Strahlrichtung: als runde Scheibe je Hitbox verriete er
   * genau die Perlenkette, die der Partikelstrom gerade aufloest, deshalb wird er entlang der
   * Bruecke gestreckt und am ausbrennenden Ende ausgeblendet.
   */
  private updateGlow(visual: FlameVisual, ageMs: number): void {
    const scale = glowScale(visual.size);
    const stretch = visual.bridgeLen > 0
      ? Math.min(1 + visual.bridgeLen / Math.max(visual.size, 24), 2.2)
      : 1.25;
    visual.glowImage.setRotation(Math.atan2(visual.dirY, visual.dirX));
    visual.glowImage.setScale(scale * stretch, scale);
    visual.glowImage.setAlpha(emissiveAlpha(visual.glowBaseAlpha * (0.3 + 0.7 * heatOf(ageMs))));
  }

  private spawnCore(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number, ageMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    const place = this.placeSpawn(visual, nowMs, ageMs, CORE_LATERAL_FRACTION, 2.5);
    const advect = visual.speed * CORE_FORWARD_INHERIT;
    const lateral = spreadFactor() * (14 + place.size * 0.22);
    const length = 10 + place.size * 0.35;

    spec.frame = GpuVfxFrameId.FlameTongue;
    spec.lifeMs = Phaser.Math.FloatBetween(CORE_LIFESPAN.min, CORE_LIFESPAN.max);
    spec.x = place.x;
    spec.y = place.y;
    spec.vx = place.dirX * advect - place.dirY * lateral;
    spec.vy = place.dirY * advect + place.dirX * lateral + CORE_BUOYANCY;
    // Die Zunge liegt in der Stroemung; der kleine Winkelfehler haelt den Strahl unruhig.
    spec.rotation = Math.atan2(spec.vy, spec.vx) + Phaser.Math.FloatBetween(-0.18, 0.18);
    spec.angularVelocity = Phaser.Math.FloatBetween(-0.6, 0.6);
    spec.scaleStart = length / 32;
    spec.scaleEnd = spec.scaleStart * 1.3;
    // Gestreckt geboren, beim Ausbrennen wieder rund.
    spec.stretchStart = 1.15;
    spec.stretchEnd = 0.95;
    spec.tint = pickHeatTint(visual.hotTints, visual.midTints, visual.coolTints, place.heat * 0.55 + 0.45);
    system.spawn(spec, visual.source, nowMs);
  }

  private spawnOuter(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number, ageMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    const place = this.placeSpawn(visual, nowMs, ageMs, OUTER_LATERAL_FRACTION, 4);
    const advect = visual.speed * OUTER_FORWARD_INHERIT;
    const lateral = spreadFactor() * (20 + place.size * 0.35);
    const diameter = 12 + place.size * 0.42;

    spec.frame = GpuVfxFrameId.FlameBillow;
    spec.lifeMs = Phaser.Math.FloatBetween(OUTER_LIFESPAN.min, OUTER_LIFESPAN.max);
    spec.x = place.x;
    spec.y = place.y;
    spec.vx = place.dirX * advect - place.dirY * lateral;
    spec.vy = place.dirY * advect + place.dirX * lateral + OUTER_BUOYANCY;
    // An der Stroemung ausgerichtet und in ihre Richtung gestreckt: benachbarte Ballen
    // ueberlappen dadurch entlang des Strahls, statt als runde Tupfen nebeneinanderzuliegen.
    spec.rotation = Math.atan2(place.dirY, place.dirX) + Phaser.Math.FloatBetween(-0.35, 0.35);
    spec.angularVelocity = Phaser.Math.FloatBetween(-0.9, 0.9);
    spec.scaleStart = diameter / 32;
    // Ein Gasballen dehnt sich beim Abkuehlen aus und verliert dabei seine Streckung.
    spec.scaleEnd = spec.scaleStart * 1.45;
    spec.stretchStart = 1.55;
    spec.stretchEnd = 1.1;
    spec.tint = pickHeatTint(visual.hotTints, visual.midTints, visual.coolTints, place.heat);
    system.spawn(spec, visual.source, nowMs);
  }

  private spawnSpark(visual: FlameVisual, spec: GpuVfxSpawnSpec, nowMs: number, ageMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    const place = this.placeSpawn(visual, nowMs, ageMs, SPARK_LATERAL_FRACTION, 3);
    const advect = visual.speed * SPARK_FORWARD_INHERIT;
    const lateral = spreadFactor() * (30 + place.size * 0.3);

    spec.frame = visual.isVoid ? GpuVfxFrameId.FlameSparkVoid : GpuVfxFrameId.FlameSpark;
    spec.lifeMs = Phaser.Math.FloatBetween(SPARK_LIFESPAN.min, SPARK_LIFESPAN.max);
    spec.x = place.x;
    spec.y = place.y;
    spec.vx = place.dirX * advect - place.dirY * lateral;
    spec.vy = place.dirY * advect + place.dirX * lateral + SPARK_BUOYANCY;
    spec.rotation = 0;
    spec.angularVelocity = 0;
    spec.tint = pickGpuVfxTint(visual.sparkTints);
    system.spawn(spec, visual.source, nowMs);
  }

  /**
   * Legt einen Spawn gleichverteilt auf `[-Nachlauf, Bruecke]` ab und liefert den dort
   * gueltigen Zustand des Strahls.
   *
   * Gleichverteilt *in der Laenge* – nicht je Abschnitt gleich viele – sonst haengt die Dichte
   * davon ab, wie weit zwei Kettenglieder gerade auseinanderliegen. Die Fenster benachbarter
   * Hitboxen ueberlappen sich bewusst: dadurch gibt es an den Kettengliedern keine Naht.
   *
   * Die Streuung quer zur Stroemung ist dreiecksverteilt: gleichverteilte Punkte in einem Kreis
   * lassen den Rand ebenso dicht wirken wie die Mitte und nehmen dem Strahl seinen Kern.
   */
  private placeSpawn(
    visual: FlameVisual,
    nowMs: number,
    ageMs: number,
    lateralFraction: number,
    minLateralPx: number,
  ): typeof SPAWN_PLACE {
    const along = Phaser.Math.FloatBetween(-visual.smearPx, visual.bridgeLen);

    if (along >= 0 && visual.bridgeLen > 0) {
      const u = along / visual.bridgeLen;
      SPAWN_PLACE.x = visual.x + visual.bridgeX * u;
      SPAWN_PLACE.y = visual.y + visual.bridgeY * u;
      SPAWN_PLACE.size = visual.size + (visual.bridgeSize - visual.size) * u;
      // Der Vorgaenger ist aelter, also kaelter: die Bruecke traegt den Temperaturverlauf.
      SPAWN_PLACE.heat = heatOf(ageMs + (nowMs - visual.bridgeBirthMs - ageMs) * u);
      setLerpedDirection(visual.dirX, visual.dirY, visual.bridgeDirX, visual.bridgeDirY, u);
    } else {
      const back = Math.max(0, -along);
      SPAWN_PLACE.x = visual.x - visual.dirX * back;
      SPAWN_PLACE.y = visual.y - visual.dirY * back;
      // Weiter hinten war die Hitbox juenger, schmaler und heisser.
      const shrink = visual.smearPx > 0 ? 1 - 0.25 * (back / visual.smearPx) : 1;
      SPAWN_PLACE.size = visual.size * shrink;
      SPAWN_PLACE.heat = heatOf(ageMs - (visual.speed > 0.001 ? (back / visual.speed) * 1000 : 0));
      SPAWN_PLACE.dirX = visual.dirX;
      SPAWN_PLACE.dirY = visual.dirY;
    }

    if (SPAWN_PLACE.dirX === 0 && SPAWN_PLACE.dirY === 0) {
      // Vor dem ersten `updateVisual` ist keine Richtung bekannt; dann streut die Hitbox
      // isotrop statt in eine willkuerliche Achse.
      const angle = Math.random() * Math.PI * 2;
      SPAWN_PLACE.dirX = Math.cos(angle);
      SPAWN_PLACE.dirY = Math.sin(angle);
    }

    const radius = Math.max(SPAWN_PLACE.size * lateralFraction, minLateralPx);
    const lateral = spreadFactor() * radius;
    SPAWN_PLACE.x += -SPAWN_PLACE.dirY * lateral;
    SPAWN_PLACE.y += SPAWN_PLACE.dirX * lateral;
    return SPAWN_PLACE;
  }
}

/** Interpoliert zwei Richtungen und schreibt das Ergebnis normiert in `SPAWN_PLACE`. */
function setLerpedDirection(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  u: number,
): void {
  const x = fromX + (toX - fromX) * u;
  const y = fromY + (toY - fromY) * u;
  const length = Math.hypot(x, y);
  if (length < 0.001) {
    // Gegenlaeufige Richtungen heben sich auf; dann gilt die der juengeren Hitbox.
    SPAWN_PLACE.dirX = fromX;
    SPAWN_PLACE.dirY = fromY;
    return;
  }
  SPAWN_PLACE.dirX = x / length;
  SPAWN_PLACE.dirY = y / length;
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
