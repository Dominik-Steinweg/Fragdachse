/**
 * Performance-Ablation – Entwickler-Diagnosemodus für gezielte Ursachenmessung.
 *
 * Ein Trace zeigt, *wieviel* Zeit ein Frame kostet, aber nicht, *wodurch*. Korrelationen über
 * eine normal gespielte Runde sind dafür zu schwach: Partikel, Lichter, Blut und Objektzahl
 * steigen und fallen gemeinsam, sodass sich ihre Anteile nicht trennen lassen.
 *
 * Dieser Modus schaltet deshalb während einer laufenden Aufzeichnung einzelne Darstellungs-
 * aspekte für je ein Zeitfenster ab und misst den Unterschied gegen ein unmittelbar davor
 * liegendes Baseline-Fenster. Weil Ablation und Baseline direkt benachbart sind, sind sie
 * gegen langsame Drift (Gegnerzahl, Blutmenge, Rundenfortschritt) weitgehend robust.
 *
 * Das Spiel ist in diesem Modus bewusst nicht gut spielbar – es verschwinden sichtbar Dinge.
 * Es ist ein reines Messwerkzeug.
 *
 * ## Warum in jedem Segment gescannt wird
 *
 * Die Ablation hält ihre Objekte per Frame-Scan über die Display-Liste versteckt, weil während
 * eines Segments laufend neue Objekte entstehen (Blut, Partikel, Projektile). Damit die Kosten
 * dieses Scans die Messung nicht verfälschen, läuft er **auch im Baseline-Segment** – dort nur
 * ohne zu verstecken. Der Scan ist damit in allen Segmenten gleich teuer und fällt aus der
 * Differenz Baseline↔Ablation heraus.
 */
import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../../config';
import type { GraphicsQualityController } from '../../graphics/GraphicsQuality';

/** Reihenfolge ist die Reihenfolge im Trace; `baseline` wird zwischen alle Ablationen gelegt. */
export type AblationCategory =
  | 'baseline'
  | 'filters'
  | 'particles'
  | 'lights'
  | 'staticShadows'
  | 'dynamicShadows'
  | 'blood'
  | 'rocks'
  | 'groundFire'
  | 'projectiles'
  | 'staticDecor'
  | 'train'
  | 'hud'
  | 'postFx';

export const ABLATION_CODES: Readonly<Record<AblationCategory, number>> = {
  baseline: 0,
  filters: 1,
  particles: 2,
  lights: 3,
  staticShadows: 4,
  blood: 5,
  rocks: 6,
  groundFire: 7,
  projectiles: 8,
  staticDecor: 9,
  hud: 10,
  dynamicShadows: 11,
  train: 12,
  postFx: 13,
};

/** Was in einem Segment abgeschaltet wird – erscheint so auch in der Anleitung und im Overlay. */
export const ABLATION_LABELS: Readonly<Record<AblationCategory, string>> = {
  baseline: 'Baseline (nichts abgeschaltet)',
  filters: 'Objektfilter (Glow/Blur, ohne Kamera-PostFX)',
  particles: 'Alle Partikel-Emitter',
  lights: 'Dynamische Beleuchtung (Composite)',
  staticShadows: 'Statische Schatten (gebackene Layer)',
  dynamicShadows: 'Schatten bewegter Werfer',
  blood: 'Blut-Decals',
  rocks: 'Felsen',
  groundFire: 'Bodenfeuer, Flammen, Hitzeflimmern',
  projectiles: 'Projektil-Visuals',
  staticDecor: 'Statische Deko (Boden, Decals, Kronen)',
  train: 'Zug (Lok, Waggons, Zug-Schatten)',
  hud: 'HUD und bildschirmfeste UI',
  postFx: 'Bildkomposition der Weltkamera (Grading, Vignette, Bloom)',
};

/**
 * Die messbaren Kategorien. Ausgewählt nach dem, was in bisherigen Traces tatsächlich
 * Gewicht hatte: Filter (fixer Render-Boden), Partikel (bis 4758 gleichzeitig), Lichter
 * (Lightmap pro Frame), Blut (bis 538 Bilder), Felsen (584 Bilder) sowie Bodenfeuer, HUD,
 * Projektile und die gebackene statische Deko als Gegenprobe.
 */
export const ABLATION_CATEGORIES: readonly AblationCategory[] = [
  'filters',
  'particles',
  'lights',
  'staticShadows',
  'dynamicShadows',
  'blood',
  'rocks',
  'groundFire',
  'projectiles',
  'staticDecor',
  'train',
  'hud',
  'postFx',
];

export interface AblationSegment {
  atMs: number;
  durationMs: number;
  category: AblationCategory;
}

export interface PerformanceAblationDeps {
  /** Filter laufen über den Quality-Controller, der sie ohnehin schon alle kennt. */
  getQualityController: () => GraphicsQualityController | null;
  /**
   * Schatten haben eine eigene Sichtbarkeits-API, getrennt nach gebackenen statischen Layern
   * und den pro Frame gezeichneten dynamischen. `null` ausserhalb einer Runde.
   */
  getShadowSystem: () => {
    setStaticVisible(visible: boolean): void;
    setDynamicVisible(visible: boolean): void;
  } | null;
  /**
   * Das Lightmap-Composite braucht einen eigenen Schalter. Über den generischen Scan ist
   * es nicht abzuschalten: `LightingSystem.update()` setzt die Sichtbarkeit des Overlays
   * jeden Frame neu, ein `setVisible(false)` von aussen wäre einen Frame später wieder
   * überschrieben und das Segment würde nichts messen. `null` ausserhalb einer Runde.
   */
  getLightingSystem: () => {
    setCompositeSuppressed(suppressed: boolean): void;
  } | null;
  /**
   * Die Bildkomposition der Weltkamera bekommt eine eigene Kategorie, obwohl ihre Filter
   * bereits im Quality-Controller hängen: ihr Kostenprofil ist ein anderes. Objekt-Glows
   * kosten pro Objekt, ein Vollbild-Bloom kostet einen Offscreen-Pass in
   * Backing-Store-Auflösung. Beides in einer Zahl wäre für die Diagnose wertlos.
   *
   * Optional, damit bestehende Aufrufer und Tests unverändert bleiben.
   */
  getPostFxController?: () => {
    setEnabled(enabled: boolean): void;
  } | null;
}

const BLOOD_TEXTURE_PREFIX = '__blood';
const GROUND_FIRE_TEXTURE_HINTS = ['flame', 'fire', 'ember', 'spark', 'heat_haze', 'smoke'];
const STATIC_DECOR_TEXTURE_HINTS = ['dirt', 'kiesel', 'decal', 'canopy', 'gras_bg'];

function textureKeyOf(object: Phaser.GameObjects.GameObject): string {
  return (object as Phaser.GameObjects.GameObject & { texture?: { key?: string } }).texture?.key ?? '';
}

function depthOf(object: Phaser.GameObjects.GameObject): number {
  return (object as Phaser.GameObjects.GameObject & { depth?: number }).depth ?? 0;
}

function isScreenFixed(object: Phaser.GameObjects.GameObject): boolean {
  const factor = (object as Phaser.GameObjects.GameObject & { scrollFactorX?: number }).scrollFactorX;
  return factor === 0;
}

/**
 * Ordnet ein Display-Objekt einer Kategorie zu. Die Zuordnung ist bewusst heuristisch über
 * Texturschlüssel, Typ und Tiefenband – ein Diagnosewerkzeug darf dafür keine Marker in den
 * Produktionscode aller Renderer streuen. Fehlzuordnungen kosten hier nur Messschärfe.
 */
function matchesCategory(object: Phaser.GameObjects.GameObject, category: AblationCategory): boolean {
  const key = textureKeyOf(object).toLowerCase();
  const depth = depthOf(object);

  switch (category) {
    case 'particles':
      return object.type === 'ParticleEmitter';
    case 'lights':
      // Das Composite selbst läuft über `setCompositeSuppressed`, nicht über den Scan.
      // Hier bleiben nur die Scratch-Texturen der verdeckenden Lichter, die knapp
      // darunter liegen. Die Untergrenze schliesst bewusst den gebackenen Kronenschatten
      // auf `DEPTH_LIGHTING - 0.1` aus – der gehört zu `staticShadows`.
      return depth > DEPTH_LIGHTING - 0.05 && depth < DEPTH_LIGHTING;
    case 'blood':
      return key.startsWith(BLOOD_TEXTURE_PREFIX);
    case 'rocks':
      return key === 'rocks';
    case 'groundFire':
      return GROUND_FIRE_TEXTURE_HINTS.some((hint) => key.includes(hint));
    case 'projectiles':
      return depth >= DEPTH.PROJECTILES - 0.5 && depth <= DEPTH.FIRE;
    case 'staticDecor':
      return STATIC_DECOR_TEXTURE_HINTS.some((hint) => key.includes(hint))
        || depth === DEPTH.DIRT
        || depth === DEPTH.DECALS;
    case 'train':
      // Lok, Waggons und ihre Schatten liegen im schmalen Band um DEPTH.TRAIN.
      return depth >= DEPTH.TRAIN - 0.2 && depth <= DEPTH.TRAIN + 0.2;
    case 'hud':
      return isScreenFixed(object) || depth >= DEPTH.LOCAL_UI;
    case 'filters':
    case 'staticShadows':
    case 'dynamicShadows':
    case 'postFx':
    case 'baseline':
    default:
      // Diese Kategorien laufen ueber Systemschalter, nicht ueber die Display-Liste.
      return false;
  }
}

export class PerformanceAblationController {
  private active = false;
  private currentIndex = 0;
  private currentCategory: AblationCategory = 'baseline';
  private segmentStartedAtMs = 0;
  private segmentMs = 4000;
  /** Genau die Objekte, die *wir* versteckt haben – nie vom Spiel versteckte mitrestaurieren. */
  private readonly hidden = new Set<Phaser.GameObjects.GameObject>();
  /**
   * Zusaetzlich deaktivierte Objekte (nur Partikel-Emitter).
   *
   * Phasers `UpdateList` prueft `active`, nicht `visible` – ein bloss unsichtbarer Emitter
   * simuliert seine Partikel unveraendert weiter. `setVisible(false)` allein misst deshalb nur
   * die Renderkosten und unterschlaegt die deutlich groessere Simulation.
   */
  private readonly deactivated = new Set<Phaser.GameObjects.GameObject>();
  private filtersSuppressed = false;
  private postFxSuppressed = false;
  private staticShadowsSuppressed = false;
  private dynamicShadowsSuppressed = false;
  private lightCompositeSuppressed = false;
  private readonly segments: AblationSegment[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: PerformanceAblationDeps,
  ) {}

  isActive(): boolean {
    return this.active;
  }

  getCurrentCategory(): AblationCategory {
    return this.active ? this.currentCategory : 'baseline';
  }

  getSegments(): readonly AblationSegment[] {
    return this.segments;
  }

  getSegmentMs(): number {
    return this.segmentMs;
  }

  /**
   * Ein voller Durchlauf besteht aus `baseline` + je einer Ablation pro Kategorie, jeweils
   * mit vorangestellter Baseline. Das ist die Mindestdauer fuer einen auswertbaren Trace.
   */
  getCycleDurationMs(): number {
    return this.segmentMs * (ABLATION_CATEGORIES.length * 2 + 1);
  }

  start(segmentMs = 4000, now = performance.now()): void {
    this.segmentMs = Math.max(1000, segmentMs);
    this.active = true;
    this.currentIndex = 0;
    this.segments.length = 0;
    this.segmentStartedAtMs = now;
    this.currentCategory = 'baseline';
  }

  stop(now = performance.now()): void {
    if (!this.active) return;
    this.closeSegment(now);
    this.active = false;
    this.currentCategory = 'baseline';
    this.restoreAll();
  }

  /**
   * Pro Frame aufzurufen. Schaltet bei Segmentende weiter und haelt die Ablation aufrecht,
   * weil waehrend eines Segments laufend neue Objekte entstehen.
   */
  update(now = performance.now()): void {
    if (!this.active) return;

    if (now - this.segmentStartedAtMs >= this.segmentMs) {
      this.closeSegment(now);
      this.restoreAll();
      this.currentIndex += 1;
      this.segmentStartedAtMs = now;
      this.currentCategory = this.resolveCategory(this.currentIndex);
    }

    this.applyCurrent();
  }

  /**
   * Abwechselnd Baseline und Ablation: 0=baseline, 1=cat0, 2=baseline, 3=cat1, ...
   * So hat jede Ablation direkt davor eine frische Baseline zum Vergleich.
   */
  private resolveCategory(index: number): AblationCategory {
    if (index % 2 === 0) return 'baseline';
    const categoryIndex = (index - 1) / 2;
    return ABLATION_CATEGORIES[categoryIndex % ABLATION_CATEGORIES.length];
  }

  private closeSegment(now: number): void {
    this.segments.push({
      atMs: this.segmentStartedAtMs,
      durationMs: Math.max(0, now - this.segmentStartedAtMs),
      category: this.currentCategory,
    });
  }

  private applyCurrent(): void {
    const category = this.currentCategory;

    // Systemschalter
    this.setFiltersSuppressed(category === 'filters');
    this.setStaticShadowsSuppressed(category === 'staticShadows');
    this.setDynamicShadowsSuppressed(category === 'dynamicShadows');
    this.setLightCompositeSuppressed(category === 'lights');
    this.setPostFxSuppressed(category === 'postFx');

    // Der Scan laeuft in JEDEM Segment inklusive Baseline und wertet immer das Praedikat aus,
    // damit seine Kosten in allen Segmenten gleich sind und aus der Differenz
    // Baseline<->Ablation herausfallen. Fuer `baseline`, `filters` und die Schatten-Kategorien liefert
    // `matchesCategory` grundsaetzlich `false`, es wird dort also nichts versteckt.
    for (const child of this.scene.children.list) {
      const visible = (child as Phaser.GameObjects.GameObject & { visible?: boolean }).visible;
      if (visible === false) continue;
      if (!matchesCategory(child, category)) continue;
      (child as Phaser.GameObjects.GameObject & { setVisible?: (v: boolean) => unknown }).setVisible?.(false);
      this.hidden.add(child);
      // Partikel zusaetzlich stilllegen: Ihre Simulation haengt an `active`, nicht an
      // `visible`. Ohne das misst die Kategorie nur das Rendern und unterschaetzt die
      // tatsaechlichen Partikelkosten um ein Vielfaches.
      if (category === 'particles' && child.active) {
        (child as Phaser.GameObjects.GameObject & { setActive?: (v: boolean) => unknown }).setActive?.(false);
        this.deactivated.add(child);
      }
    }
  }

  private setPostFxSuppressed(suppressed: boolean): void {
    if (this.postFxSuppressed === suppressed) return;
    const controller = this.deps.getPostFxController?.() ?? null;
    if (!controller) return;
    controller.setEnabled(!suppressed);
    this.postFxSuppressed = suppressed;
  }

  private setFiltersSuppressed(suppressed: boolean): void {
    if (this.filtersSuppressed === suppressed) return;
    const controller = this.deps.getQualityController();
    if (!controller) return;
    controller.setAblationFiltersDisabled(suppressed);
    this.filtersSuppressed = suppressed;
  }

  private setStaticShadowsSuppressed(suppressed: boolean): void {
    if (this.staticShadowsSuppressed === suppressed) return;
    const shadows = this.deps.getShadowSystem();
    if (!shadows) return;
    shadows.setStaticVisible(!suppressed);
    this.staticShadowsSuppressed = suppressed;
  }

  private setDynamicShadowsSuppressed(suppressed: boolean): void {
    if (this.dynamicShadowsSuppressed === suppressed) return;
    const shadows = this.deps.getShadowSystem();
    if (!shadows) return;
    shadows.setDynamicVisible(!suppressed);
    this.dynamicShadowsSuppressed = suppressed;
  }

  private setLightCompositeSuppressed(suppressed: boolean): void {
    if (this.lightCompositeSuppressed === suppressed) return;
    const lighting = this.deps.getLightingSystem();
    if (!lighting) return;
    lighting.setCompositeSuppressed(suppressed);
    this.lightCompositeSuppressed = suppressed;
  }

  private restoreAll(): void {
    for (const object of this.hidden) {
      // Zwischenzeitlich zerstoerte Objekte verlieren ihre setVisible-Bindung nicht, das
      // Setzen ist dort folgenlos. Ein Aktiv-/Scene-Test wuerde dagegen faelschlich auch
      // gueltige, nur inaktive Objekte von der Wiederherstellung ausschliessen.
      const target = object as Phaser.GameObjects.GameObject & { setVisible?: (v: boolean) => unknown };
      if (typeof target.setVisible === 'function') target.setVisible(true);
    }
    this.hidden.clear();
    for (const object of this.deactivated) {
      const target = object as Phaser.GameObjects.GameObject & { setActive?: (v: boolean) => unknown };
      if (typeof target.setActive === 'function') target.setActive(true);
    }
    this.deactivated.clear();
    this.setFiltersSuppressed(false);
    this.setStaticShadowsSuppressed(false);
    this.setDynamicShadowsSuppressed(false);
    this.setLightCompositeSuppressed(false);
    this.setPostFxSuppressed(false);
  }

  destroy(): void {
    this.stop();
  }
}
