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
  | 'shadows'
  | 'blood'
  | 'rocks'
  | 'groundFire'
  | 'projectiles'
  | 'staticDecor'
  | 'hud';

export const ABLATION_CODES: Readonly<Record<AblationCategory, number>> = {
  baseline: 0,
  filters: 1,
  particles: 2,
  lights: 3,
  shadows: 4,
  blood: 5,
  rocks: 6,
  groundFire: 7,
  projectiles: 8,
  staticDecor: 9,
  hud: 10,
};

/** Was in einem Segment abgeschaltet wird – erscheint so auch in der Anleitung und im Overlay. */
export const ABLATION_LABELS: Readonly<Record<AblationCategory, string>> = {
  baseline: 'Baseline (nichts abgeschaltet)',
  filters: 'Glow-/PostFX-Filter',
  particles: 'Alle Partikel-Emitter',
  lights: 'Dynamische Beleuchtung (Composite)',
  shadows: 'Schatten',
  blood: 'Blut-Decals',
  rocks: 'Felsen',
  groundFire: 'Bodenfeuer, Flammen, Hitzeflimmern',
  projectiles: 'Projektil-Visuals',
  staticDecor: 'Statische Deko (Boden, Decals, Kronen)',
  hud: 'HUD und bildschirmfeste UI',
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
  'shadows',
  'blood',
  'rocks',
  'groundFire',
  'projectiles',
  'staticDecor',
  'hud',
];

export interface AblationSegment {
  atMs: number;
  durationMs: number;
  category: AblationCategory;
}

export interface PerformanceAblationDeps {
  /** Filter laufen über den Quality-Controller, der sie ohnehin schon alle kennt. */
  getQualityController: () => GraphicsQualityController | null;
  /** Schatten haben eine eigene Sichtbarkeits-API; `null` ausserhalb einer Runde. */
  getShadowSystem: () => { setVisible(visible: boolean): void } | null;
}

const BLOOD_TEXTURE_PREFIX = '__blood';
const GROUND_FIRE_TEXTURE_HINTS = ['flame', 'fire', 'ember', 'spark', 'heat_haze', 'smoke'];
const STATIC_DECOR_TEXTURE_HINTS = ['dirt', 'kiesel', 'decal', 'canopy', 'gras_bg', 'rocks'];

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
      // Der LightingSystem-Composite liegt exakt im schmalen Band um DEPTH_LIGHTING.
      return depth > DEPTH_LIGHTING - 0.2 && depth <= DEPTH_LIGHTING + 0.01;
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
    case 'hud':
      return isScreenFixed(object) || depth >= DEPTH.LOCAL_UI;
    case 'filters':
    case 'shadows':
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
  private filtersSuppressed = false;
  private shadowsSuppressed = false;
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
    this.setShadowsSuppressed(category === 'shadows');

    // Der Scan laeuft in JEDEM Segment inklusive Baseline und wertet immer das Praedikat aus,
    // damit seine Kosten in allen Segmenten gleich sind und aus der Differenz
    // Baseline<->Ablation herausfallen. Fuer `baseline`, `filters` und `shadows` liefert
    // `matchesCategory` grundsaetzlich `false`, es wird dort also nichts versteckt.
    for (const child of this.scene.children.list) {
      const visible = (child as Phaser.GameObjects.GameObject & { visible?: boolean }).visible;
      if (visible === false) continue;
      if (!matchesCategory(child, category)) continue;
      (child as Phaser.GameObjects.GameObject & { setVisible?: (v: boolean) => unknown }).setVisible?.(false);
      this.hidden.add(child);
    }
  }

  private setFiltersSuppressed(suppressed: boolean): void {
    if (this.filtersSuppressed === suppressed) return;
    const controller = this.deps.getQualityController();
    if (!controller) return;
    controller.setAblationFiltersDisabled(suppressed);
    this.filtersSuppressed = suppressed;
  }

  private setShadowsSuppressed(suppressed: boolean): void {
    if (this.shadowsSuppressed === suppressed) return;
    const shadows = this.deps.getShadowSystem();
    if (!shadows) return;
    shadows.setVisible(!suppressed);
    this.shadowsSuppressed = suppressed;
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
    this.setFiltersSuppressed(false);
    this.setShadowsSuppressed(false);
  }

  destroy(): void {
    this.stop();
  }
}
