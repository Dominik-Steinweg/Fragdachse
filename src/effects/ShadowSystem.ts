import * as Phaser from 'phaser';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
} from '../config';
import type { ArenaBuilderResult } from '../arena/ArenaBuilder';
import type { PlayerEntity } from '../entities/PlayerEntity';
import { TRAIN } from '../train/TrainConfig';
import type { ArenaLayout, SyncedPlaceableRock, SyncedTrainState } from '../types';
import {
  getProjectileShadowConfig,
  SHADOW_CASTERS,
  SHADOW_PROFILES,
  type ShadowCasterConfig,
  type ShadowProfile,
  type ShadowProjectileSample,
  WORLD_SHADOW_CONFIG,
} from './ShadowConfig';
import {
  getGraphicsQualityController,
  getGraphicsQualityProfile,
  type GraphicsQualityProfile,
} from '../graphics/GraphicsQuality';
import { resolveSkyState } from './TimeOfDay';
import { ChunkScratchPool, ChunkedRenderSurface } from '../arena/chunks/ChunkedRenderSurface';
import type { ChunkSamplingMode } from '../arena/chunks/ChunkedRenderSurface';
import type { ChunkBakeRegion, ChunkBakeSink, ChunkedSurfaceLayerSpec } from '../arena/chunks/ChunkedRenderSurface';
import type { ChunkWorldRect } from '../arena/chunks/ArenaChunkGrid';
import { ArenaCellBucketIndex } from '../arena/chunks/ArenaCellBucketIndex';

interface ShadowWorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface StaticShadowLayoutBuildOptions {
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly runtimeRocks?: readonly SyncedPlaceableRock[];
  readonly rockVisibilityPredicate?: (index: number) => boolean;
}

/** Welche Quelle die statischen Footprints einer Ebene liefert – bestimmt, wann neu gebacken wird. */
type StaticShadowGroup = 'rocks' | 'trees';

interface ShadowLayerBucket {
  /**
   * Zeichenpuffer der statischen Footprints **einer gerade gebackenen Region**.
   *
   * Er bleibt dauerhaft unsichtbar; sichtbar ist das gebackene Renderziel des Chunks. Ohne das
   * Backen rastert die GPU pro Frame alle gestapelten Alpha-Fuellungen neu – bei Fels 8 und
   * Krone 32 Lagen je Schattenwerfer ist das der groesste gemessene Einzelposten im Frame.
   */
  readonly staticGraphics: Phaser.GameObjects.Graphics;
  readonly dynamicGraphics: Phaser.GameObjects.Graphics;
  group: StaticShadowGroup | null;
}

interface ShadowDirtyChunk {
  readonly x: number;
  readonly y: number;
}

const SHADOW_DIRTY_CHUNK_SIZE = 128;

/**
 * Die Caster, deren Schatten gebacken werden – und damit genau die Ebenen der Chunk-Flaeche.
 *
 * Die Menge ist fest, weil die Tiefen Konstanten sind: Fels und Turret aendern sich mit dem
 * Hindernisbestand, Stamm und Krone gehoeren zum unveraenderlichen Layout. Alles andere
 * (Spieler, Projektile, Zug) ist dynamisch und wird pro Frame gezeichnet.
 */
const STATIC_SHADOW_CASTERS: ReadonlyArray<{
  readonly config: ShadowCasterConfig;
  readonly group: StaticShadowGroup;
}> = [
  { config: SHADOW_CASTERS.rock, group: 'rocks' },
  { config: SHADOW_CASTERS.turret, group: 'rocks' },
  { config: SHADOW_CASTERS.trunk, group: 'trees' },
  { config: SHADOW_CASTERS.canopy, group: 'trees' },
];
/** Leere Kandidatenliste ohne Layout – spart eine Allokation je Region. */
const EMPTY_INDEX_LIST: readonly number[] = [];

/**
 * Wie weit die Schattenhuelle eines Casters ueber seinen Mittelpunkt hinausreicht.
 *
 * Das ist die Reichweite, mit der ein raeumlicher Index nach Kandidaten fuer eine Region sucht:
 * Ein Fels ausserhalb der Region kann seinen Schatten noch hineinwerfen.
 */
function getStaticShadowReachPx(preset: ShadowCasterConfig, profile: ShadowProfile): number {
  const castLength = preset.castHeightPx * preset.stretch * profile.lengthMult;
  const inflate = preset.inflatePx + preset.softnessPx * profile.softnessMult;
  const radius = Math.max(
    preset.footprintWidthPx + inflate * 2,
    preset.footprintHeightPx + inflate * 2,
  ) * 0.5;
  const offset = (preset.airborneHeightPx ?? 0) + castLength;
  return Math.max(
    Math.abs(WORLD_SHADOW_CONFIG.lightDirection.x * offset),
    Math.abs(WORLD_SHADOW_CONFIG.lightDirection.y * offset),
  ) + radius;
}

function getMaxStaticShadowReachPx(profile: ShadowProfile): number {
  let reach = 0;
  for (const { config } of STATIC_SHADOW_CASTERS) {
    reach = Math.max(reach, getStaticShadowReachPx(config, profile));
  }
  return reach;
}

const STATIC_PROFILE_REBAKE_MIN_INTERVAL_MS = 600;
const STATIC_PROFILE_OPACITY_DELTA = 0.06;
const STATIC_PROFILE_LENGTH_DELTA = 0.08;
const STATIC_PROFILE_SOFTNESS_DELTA = 0.08;

// ---------------------------------------------------------------------------
// Pre-computed stadium arc tables.
// lightDirection is a compile-time constant so dirAngle never changes.
// Computing cos/sin once at module load avoids repeated trig calls per frame.
// ---------------------------------------------------------------------------
const STADIUM_ARC_N = 8; // arc subdivisions per semicircle
const _stadiumDirAngle = Math.atan2(
  WORLD_SHADOW_CONFIG.lightDirection.y,
  WORLD_SHADOW_CONFIG.lightDirection.x,
);
// Back cap: source semicircle faces away from shadow direction
const STADIUM_BACK_ARC: ReadonlyArray<{ readonly cos: number; readonly sin: number }> =
  Array.from({ length: STADIUM_ARC_N + 1 }, (_, i) => {
    const a = _stadiumDirAngle + Math.PI / 2 + (Math.PI * i) / STADIUM_ARC_N;
    return { cos: Math.cos(a), sin: Math.sin(a) };
  });
// Front cap: shadow semicircle faces toward shadow direction
const STADIUM_FRONT_ARC: ReadonlyArray<{ readonly cos: number; readonly sin: number }> =
  Array.from({ length: STADIUM_ARC_N + 1 }, (_, i) => {
    const a = _stadiumDirAngle - Math.PI / 2 + (Math.PI * i) / STADIUM_ARC_N;
    return { cos: Math.cos(a), sin: Math.sin(a) };
  });

export class ShadowSystem {
  private readonly layers = new Map<string, ShadowLayerBucket>();
  private worldBoundsOverride: ShadowWorldBounds | null = null;
  private profile: ShadowProfile = SHADOW_PROFILES.day;
  /** Profil, das tatsaechlich in den sichtbaren statischen RenderTextures steckt. */
  private lastBakedProfile: ShadowProfile | null = null;
  private lastStaticProfileBakeAtMs = Number.NEGATIVE_INFINITY;
  private quality: GraphicsQualityProfile;
  private unsubscribeQuality: (() => void) | null = null;
  private lastStaticLayout: ArenaLayout | null = null;
  private lastStaticOptions: StaticShadowLayoutBuildOptions = {};
  /** Von aussen gesetzte Sichtbarkeit; kombiniert sich mit dem Inhalt der gebackenen Layer. */
  private shadowsVisible = true;
  private staticSamplingMode: ChunkSamplingMode = 'default';
  /**
   * Die gebackenen statischen Schatten liegen in Render-Chunks statt in je einer arenagrossen
   * RenderTexture je Ebene. Auf einer 400 x 80-Karte waeren das vier Ziele zu 12 800 x 2 560 px;
   * jetzt folgt der Speicher dem sichtbaren Ausschnitt (siehe `arena/chunks`).
   */
  private staticSurface: ChunkedRenderSurface | null = null;
  private readonly staticScratch = new ChunkScratchPool(this.scene);
  /** Rahmen, fuer den `staticSurface` gebaut wurde – aendern sich die Bounds, wird er ersetzt. */
  private staticSurfaceFrameKey = '';
  /** Profil, mit dem die Chunks gebacken werden. Ein Dirty-Rebake darf nicht vorauseilen. */
  private staticBakeProfile: ShadowProfile = SHADOW_PROFILES.day;
  /**
   * Zuletzt gemeldeter Kameraausschnitt. `null` heisst "kein Streaming" und macht den gesamten
   * Rahmen resident – der Zustand der Lobby-Vorschau, deren Rahmen ohnehin bildschirmgross ist.
   */
  private staticResidencyView: ChunkWorldRect | null = null;
  private staticHasLayout = false;
  /** Raeumlicher Index ueber `layout.rocks`; Positionen im Array sind die Fels-IDs. */
  private staticRockIndex = new ArenaCellBucketIndex(1);
  /** Wiederverwendete Puffer – eine Allokation je Region weniger. */
  private readonly staticRockCandidates: number[] = [];
  private readonly staticRuntimeById = new Map<number, SyncedPlaceableRock>();

  // Reusable point buffers — mutated in-place each draw call to avoid
  // allocating hundreds of Vector2 objects per frame.
  private readonly stadiumPts: Phaser.Math.Vector2[] =
    Array.from({ length: (STADIUM_ARC_N + 1) * 2 }, () => new Phaser.Math.Vector2());
  private readonly cellPts: Phaser.Math.Vector2[] =
    Array.from({ length: 6 }, () => new Phaser.Math.Vector2());

  constructor(
    private readonly scene: Phaser.Scene,
  ) {
    this.quality = getGraphicsQualityProfile(scene);
    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe((profile) => {
      this.quality = profile;
      if (this.lastStaticLayout) {
        this.rebuildStaticLayoutShadows(this.lastStaticLayout, this.lastStaticOptions);
      }
    }) ?? null;
  }

  setWorldBoundsOverride(bounds: ShadowWorldBounds | null): void {
    this.worldBoundsOverride = bounds;
  }

  /**
   * Meldet den sichtbaren Weltausschnitt fuer das Chunk-Streaming der gebackenen Schatten.
   *
   * Gehoert in denselben Frame-Abschnitt wie {@link ArenaBuilder.updateSurfaceResidency}. Wird der
   * Aufruf nie gemacht – so wie in der Lobby-Vorschau – bleibt der gesamte Rahmen resident.
   */
  updateStaticResidency(view: ChunkWorldRect | null): void {
    this.staticResidencyView = view;
    if (!this.staticSurface) return;
    this.staticSurface.updateResidency(view ?? this.getStaticFrameRect());
  }

  /** Startup barrier for the static-shadow working set. */
  isStaticReadyForView(view: ChunkWorldRect, includePrefetch = true): boolean {
    if (!this.staticHasLayout || !this.staticSurface) return false;
    return this.staticSurface.isReadyForView(view, includePrefetch);
  }

  /**
   * Setzt die Uhrzeit der Runde. Zur Nacht hin bleiben die Sonnenschatten erhalten,
   * werden aber zu kurzen, weichen und blassen Mondschatten. Vor einem Rebuild der
   * statischen Layer setzen – dynamische Schatten übernehmen es ab dem nächsten Frame.
   */
  setTimeOfDay(minutes: number): void {
    const sky = resolveSkyState(minutes);
    this.profile = {
      opacityMult: sky.shadowOpacityMult,
      lengthMult: sky.shadowLengthMult,
      softnessMult: sky.shadowSoftnessMult,
    };
  }

  /**
   * Backt alle statischen Layer mit dem aktuellen Profil neu.
   *
   * Nicht ueber `rebuildArenaStaticShadows()` erreichbar: das ist der
   * Hindernis-Invalidierungspfad und laesst bei unveraendertem Layout die Baum-Schatten
   * bewusst stehen (siehe dort). Ein Profilwechsel aendert aber Laenge, Deckkraft und
   * Weichheit *aller* Caster, Stamm und Krone eingeschlossen – und die Krone ist mit
   * `softnessPx: 98` und 32 Lagen der auffaelligste Schatten im Bild.
   */
  rebuildStaticShadowsForProfileChange(): void {
    if (!this.lastStaticLayout) return;
    this.rebuildStaticLayoutShadowsWithProfile(
      this.lastStaticLayout,
      this.lastStaticOptions,
      this.profile,
    );
  }

  /** Gleicht nur die teuren statischen Bakes gedrosselt an das laufende Profil an. */
  syncStaticProfile(synchronizedNowMs: number, force = false): boolean {
    if (!this.lastStaticLayout) return false;
    const nowMs = Number.isFinite(synchronizedNowMs) ? synchronizedNowMs : 0;
    const baked = this.lastBakedProfile;
    if (!force) {
      if (baked && !hasRelevantStaticProfileChange(baked, this.profile)) return false;
      if (nowMs - this.lastStaticProfileBakeAtMs < STATIC_PROFILE_REBAKE_MIN_INTERVAL_MS) return false;
    }
    this.rebuildStaticLayoutShadowsWithProfile(
      this.lastStaticLayout,
      this.lastStaticOptions,
      this.profile,
      nowMs,
    );
    return true;
  }

  setVisible(visible: boolean): void {
    this.setStaticVisible(visible);
    this.setDynamicVisible(visible);
  }

  /**
   * Nur die gebackenen statischen Layer. Getrennt schaltbar, damit der Ablationsmodus den
   * Composite der gebackenen Texturen von den pro Frame gezeichneten dynamischen Schatten
   * unterscheiden kann – ohne die Trennung ist der Restbetrag nicht zuzuordnen.
   */
  setStaticVisible(visible: boolean): void {
    this.shadowsVisible = visible;
    // `staticGraphics` bleibt dauerhaft unsichtbar – sichtbar sind die gebackenen Chunks.
    this.syncStaticSurfaceVisibility();
  }

  isStaticVisible(): boolean {
    return this.shadowsVisible;
  }

  /** Affects only the render textures used by the baked static shadow chunks. */
  setSamplingMode(mode: ChunkSamplingMode): void {
    this.staticSamplingMode = mode;
    this.staticSurface?.setSamplingMode(mode);
  }

  getSamplingMode(): ChunkSamplingMode {
    return this.staticSamplingMode;
  }

  setDynamicVisible(visible: boolean): void {
    for (const bucket of this.layers.values()) bucket.dynamicGraphics.setVisible(visible);
  }

  private syncStaticSurfaceVisibility(): void {
    this.staticSurface?.setVisible(this.shadowsVisible && this.staticHasLayout);
  }

  rebuildStaticLayoutShadows(
    layout: ArenaLayout | null,
    options: StaticShadowLayoutBuildOptions = {},
  ): void {
    this.lastStaticLayout = layout;
    this.lastStaticOptions = options;
    if (!layout) {
      this.clearStatic();
      this.lastBakedProfile = null;
      return;
    }
    this.rebuildStaticLayoutShadowsWithProfile(layout, options, this.profile);
  }

  /**
   * Setzt Zustand und Backprofil und laesst alle residenten Chunks neu backen.
   *
   * Es gibt seit dem Chunk-Streaming keinen arenaweiten Bake mehr: Fels-, Turret-, Stamm- und
   * Kronenschatten entstehen gemeinsam je Region, gefiltert auf die Caster, deren Schattenhuelle
   * die Region ueberhaupt beruehrt. Die frueher noetige Trennung in eine veraenderliche
   * Fels-Gruppe und eine unveraenderliche Baum-Gruppe entfaellt damit: Ein Chunk enthaelt in der
   * Regel gar keinen Baum, und wo doch, ist es genau einer.
   */
  private rebuildStaticLayoutShadowsWithProfile(
    layout: ArenaLayout,
    options: StaticShadowLayoutBuildOptions,
    profile: ShadowProfile,
    bakedAtMs = Number.NEGATIVE_INFINITY,
  ): void {
    if (this.lastStaticLayout !== layout) {
      // Neues Layout heisst neuer Felsbestand: Der raeumliche Index muss von vorn beginnen,
      // sonst zeigte er auf Positionen der Vorrunde.
      const bounds = this.getStaticWorldBounds();
      this.staticRockIndex = new ArenaCellBucketIndex(Math.max(1, bounds.maxX - bounds.minX));
    }
    this.lastStaticLayout = layout;
    this.lastStaticOptions = options;
    this.staticBakeProfile = profile;
    this.staticHasLayout = true;
    const { surface, created } = this.ensureStaticSurface();
    // Ein frisch erzeugter Chunk hat seine 128-px-Regionen bereits im gemeinsamen Scheduler;
    // ein zweiter Voll-Plan waere beim Rundenstart doppelte Arbeit.
    if (!created) surface.refreshAll();
    this.syncStaticSurfaceVisibility();
    this.lastBakedProfile = { ...profile };
    this.lastStaticProfileBakeAtMs = bakedAtMs;
  }

  rebuildArenaStaticShadows(
    layout: ArenaLayout | null,
    arenaResult: ArenaBuilderResult | null,
    runtimeRocks: readonly SyncedPlaceableRock[] = [],
  ): void {
    if (!layout || !arenaResult) {
      this.clearStatic();
      return;
    }

    const options: StaticShadowLayoutBuildOptions = {
      offsetX: ARENA_OFFSET_X,
      offsetY: ARENA_OFFSET_Y,
      runtimeRocks,
      rockVisibilityPredicate: (index) => Boolean(arenaResult.rockObjects[index]?.active),
    };

    // Dies ist der Invalidierungspfad: Er laeuft, wenn sich die Hindernisse geaendert haben.
    // Solange dasselbe Layout gilt, darf das bereits gebackene Profil weitergelten – sonst
    // eilte ein Neubau einem noch ausstehenden Profilwechsel voraus und liesse alte Felsraender
    // als Geisterschatten stehen.
    const sameLayout = this.lastStaticLayout === layout;
    const staticProfile = sameLayout ? (this.lastBakedProfile ?? this.profile) : this.profile;
    this.rebuildStaticLayoutShadowsWithProfile(layout, options, staticProfile);
  }

  /**
   * Rekonstruiert nach bekannten Fels-Aenderungen nur die betroffenen Schatten-Chunks.
   *
   * Die Update-Granularitaet bleibt {@link SHADOW_DIRTY_CHUNK_SIZE} = 128 px. Ein weisser
   * Scratch-Chunk ersetzt den entsprechenden Bereich des residenten Renderziels; dadurch bleiben
   * ueberlappende Nachbarschatten korrekt, ohne alle Felsen neu zu zeichnen.
   */
  rebuildArenaStaticShadowRegions(
    layout: ArenaLayout | null,
    arenaResult: ArenaBuilderResult | null,
    dirtyRockIds: ReadonlySet<number>,
    runtimeRocks: readonly SyncedPlaceableRock[] = [],
  ): void {
    if (!layout || !arenaResult || dirtyRockIds.size === 0) return;
    if (this.lastStaticLayout !== layout || !this.staticSurface) {
      this.rebuildArenaStaticShadows(layout, arenaResult, runtimeRocks);
      return;
    }

    this.lastStaticOptions = {
      offsetX: ARENA_OFFSET_X,
      offsetY: ARENA_OFFSET_Y,
      runtimeRocks,
      rockVisibilityPredicate: (index) => Boolean(arenaResult.rockObjects[index]?.active),
    };
    const staticProfile = this.lastBakedProfile ?? this.profile;
    this.staticBakeProfile = staticProfile;
    const bounds = this.getStaticWorldBounds();
    for (const chunk of this.collectDirtyShadowChunks(layout, dirtyRockIds, staticProfile)) {
      this.staticSurface.refreshRegion(
        chunk.x - bounds.minX,
        chunk.y - bounds.minY,
        SHADOW_DIRTY_CHUNK_SIZE,
      );
    }
  }

  // ── Chunk-Streaming der statischen Bakes ───────────────────────────────────

  private getStaticWorldBounds(): ShadowWorldBounds {
    return this.worldBoundsOverride ?? WORLD_SHADOW_CONFIG.arenaBounds;
  }

  private getStaticFrameRect(): ChunkWorldRect {
    const bounds = this.getStaticWorldBounds();
    return {
      x: bounds.minX,
      y: bounds.minY,
      width: Math.max(1, bounds.maxX - bounds.minX),
      height: Math.max(1, bounds.maxY - bounds.minY),
    };
  }

  /**
   * Erzeugt die Chunk-Flaeche der statischen Schatten, sobald sie gebraucht wird.
   *
   * Die Ebenenmenge ist fest: Sie folgt den vier statischen Castern aus `SHADOW_CASTERS`, deren
   * Tiefen Konstanten sind. Aendern sich die Weltgrenzen – Moduswechsel, andere Coop-Karte –,
   * wird die Flaeche verworfen und neu aufgebaut.
   */
  private ensureStaticSurface(): { surface: ChunkedRenderSurface; created: boolean } {
    const bounds = this.getStaticWorldBounds();
    const frameKey = `${bounds.minX}:${bounds.minY}:${bounds.maxX}:${bounds.maxY}`;
    if (this.staticSurface && this.staticSurfaceFrameKey === frameKey) {
      return { surface: this.staticSurface, created: false };
    }

    this.disposeStaticSurface();
    this.staticSurfaceFrameKey = frameKey;

    const layers: ChunkedSurfaceLayerSpec[] = [];
    const seen = new Set<string>();
    for (const preset of STATIC_SHADOW_CASTERS) {
      const id = preset.config.layerDepth.toFixed(3);
      // Zwei Caster koennen dieselbe Tiefe teilen; sie landen dann in derselben Ebene.
      if (seen.has(id)) continue;
      seen.add(id);
      layers.push({
        id,
        depth: preset.config.layerDepth,
        // Die Textur startet deckend weiss, die Footprints tragen ihren eigenen MULTIPLY-Blend
        // hinein. Weiss ist das neutrale Element: ausserhalb der Schatten aendert der Chunk
        // nichts. Normales Alpha-Blending waere hier *nicht* gleichwertig, weil die
        // Schattenfarbe (0x05070b) nicht exakt schwarz ist.
        blend: Phaser.BlendModes.MULTIPLY,
      });
      this.getLayer(preset.config.layerDepth, preset.group);
    }

    const frame = this.getStaticFrameRect();
    this.staticSurface = new ChunkedRenderSurface(this.scene, {
      frame: { offsetX: frame.x, offsetY: frame.y, width: frame.width, height: frame.height },
      layers,
      bake: (region, sink) => this.bakeStaticShadowRegion(region, sink),
    });
    this.staticSurface.setSamplingMode(this.staticSamplingMode);
    this.staticSurface.updateResidency(this.staticResidencyView ?? frame);
    return { surface: this.staticSurface, created: true };
  }

  private disposeStaticSurface(): void {
    this.staticSurface?.destroy();
    this.staticSurface = null;
    this.staticSurfaceFrameKey = '';
  }

  /**
   * Backt die statischen Footprints einer Region.
   *
   * Der Zeichenpuffer wird je Ebene und Region geleert und nur mit den Castern gefuellt, deren
   * Schattenhuelle die Region tatsaechlich beruehrt – genau das haelt die Kosten am sichtbaren
   * Inhalt statt an der Gesamtzahl der Felsen. Der Puffer traegt Weltkoordinaten und wird ueber
   * die Kamera des chunklokalen Scratch-Ziels eingelesen; in das Renderziel des Chunks selbst
   * gelangt danach ausschliesslich die fertige Textur.
   */
  private bakeStaticShadowRegion(region: ChunkBakeRegion, sink: ChunkBakeSink): void {
    const layout = this.lastStaticLayout;
    const profile = this.staticBakeProfile;
    const options = this.lastStaticOptions;
    const offsetX = options.offsetX ?? ARENA_OFFSET_X;
    const offsetY = options.offsetY ?? ARENA_OFFSET_Y;
    const rockVisible = options.rockVisibilityPredicate ?? (() => true);

    const regionBounds: ShadowWorldBounds = {
      minX: region.worldX,
      minY: region.worldY,
      maxX: region.worldX + region.size,
      maxY: region.worldY + region.size,
    };

    // Die Kandidaten werden **einmal je Region** bestimmt, nicht einmal je Ebene: Ein Durchlauf
    // ueber den gesamten Felsbestand mal vier Ebenen mal dutzender Dirty-Chunks war im Trace der
    // groesste Posten des `POST_UPDATE` nach einer Flaechenzerstoerung.
    this.staticRockIndex.sync(layout?.rocks ?? []);
    const reachPx = getMaxStaticShadowReachPx(profile);
    const localX = region.worldX - offsetX;
    const localY = region.worldY - offsetY;
    const rockCandidates = layout && this.staticHasLayout
      ? this.staticRockIndex.collect(localX, localY, region.size, reachPx, this.staticRockCandidates)
      : EMPTY_INDEX_LIST;

    const runtimeById = this.staticRuntimeById;
    runtimeById.clear();
    for (const rock of options.runtimeRocks ?? []) runtimeById.set(rock.id, rock);

    for (const [key, bucket] of this.layers) {
      if (!bucket.group) continue;
      const depth = Number(key);
      bucket.staticGraphics.clear();

      if (layout && this.staticHasLayout) {
        const drawsRock = SHADOW_CASTERS.rock.layerDepth === depth;
        const drawsTurret = SHADOW_CASTERS.turret.layerDepth === depth;
        if (drawsRock || drawsTurret) {
          for (const id of rockCandidates) {
            const cell = layout.rocks[id];
            if (!cell || !rockVisible(id)) continue;
            const worldX = offsetX + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
            const worldY = offsetY + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
            if (drawsRock) {
              this.drawStaticFootprintInRegion(bucket, worldX, worldY, SHADOW_CASTERS.rock, regionBounds, profile);
            }
            if (drawsTurret && runtimeById.get(id)?.kind === 'turret') {
              this.drawStaticFootprintInRegion(bucket, worldX, worldY, SHADOW_CASTERS.turret, regionBounds, profile);
            }
          }
        }
        // Baeume bleiben ungefiltert: Es sind eine Handvoll je Runde, ein Index waere teurer
        // als der Durchlauf.
        const drawsTrunk = SHADOW_CASTERS.trunk.layerDepth === depth;
        const drawsCanopy = SHADOW_CASTERS.canopy.layerDepth === depth;
        if (drawsTrunk || drawsCanopy) {
          for (const tree of layout.trees) {
            const worldX = offsetX + tree.gridX * CELL_SIZE + CELL_SIZE / 2;
            const worldY = offsetY + tree.gridY * CELL_SIZE + CELL_SIZE / 2;
            if (drawsTrunk) {
              this.drawStaticFootprintInRegion(bucket, worldX, worldY, SHADOW_CASTERS.trunk, regionBounds, profile);
            }
            if (drawsCanopy) {
              this.drawStaticFootprintInRegion(bucket, worldX, worldY, SHADOW_CASTERS.canopy, regionBounds, profile);
            }
          }
        }
      }

      const scratch = this.staticScratch.get('staticShadow', region.size);
      scratch.camera.setScroll(region.worldX, region.worldY);
      scratch.clear();
      scratch.fill(0xffffff, 1);
      // draw() rendert das Objekt mit seinem eigenen Blendmode; sichtbar muss es dafuer sein.
      bucket.staticGraphics.setVisible(true);
      scratch.draw(bucket.staticGraphics);
      scratch.render();
      bucket.staticGraphics.setVisible(false);
      bucket.staticGraphics.clear();

      sink.blit(key, scratch);
    }
  }

  private drawStaticFootprintInRegion(
    bucket: ShadowLayerBucket,
    worldX: number,
    worldY: number,
    preset: ShadowCasterConfig,
    region: ShadowWorldBounds,
    profile: ShadowProfile,
  ): void {
    const bounds = this.getShadowBounds(worldX, worldY, preset, profile);
    if (bounds.maxX <= region.minX || bounds.minX >= region.maxX
      || bounds.maxY <= region.minY || bounds.minY >= region.maxY) {
      return;
    }
    this.drawFootprint(bucket.staticGraphics, worldX, worldY, preset, undefined, undefined, profile);
  }

  private collectDirtyShadowChunks(
    layout: ArenaLayout,
    dirtyRockIds: ReadonlySet<number>,
    profile: ShadowProfile,
  ): ShadowDirtyChunk[] {
    const bounds = this.worldBoundsOverride ?? WORLD_SHADOW_CONFIG.arenaBounds;
    const chunks = new Map<string, ShadowDirtyChunk>();
    for (const id of dirtyRockIds) {
      const cell = layout.rocks[id];
      if (!cell) continue;
      const x = ARENA_OFFSET_X + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
      const y = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
      for (const preset of [SHADOW_CASTERS.rock, SHADOW_CASTERS.turret]) {
        const casterBounds = this.getShadowBounds(x, y, preset, profile);
        const minChunkX = Math.floor((Math.max(bounds.minX, casterBounds.minX) - bounds.minX) / SHADOW_DIRTY_CHUNK_SIZE);
        const minChunkY = Math.floor((Math.max(bounds.minY, casterBounds.minY) - bounds.minY) / SHADOW_DIRTY_CHUNK_SIZE);
        const maxChunkX = Math.floor((Math.min(bounds.maxX - 1, casterBounds.maxX) - bounds.minX) / SHADOW_DIRTY_CHUNK_SIZE);
        const maxChunkY = Math.floor((Math.min(bounds.maxY - 1, casterBounds.maxY) - bounds.minY) / SHADOW_DIRTY_CHUNK_SIZE);
        for (let cy = minChunkY; cy <= maxChunkY; cy += 1) {
          for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
            const chunkX = bounds.minX + cx * SHADOW_DIRTY_CHUNK_SIZE;
            const chunkY = bounds.minY + cy * SHADOW_DIRTY_CHUNK_SIZE;
            chunks.set(`${chunkX}:${chunkY}`, { x: chunkX, y: chunkY });
          }
        }
      }
    }
    return [...chunks.values()];
  }

  private getShadowBounds(
    x: number,
    y: number,
    preset: ShadowCasterConfig,
    profile: ShadowProfile,
  ): ShadowWorldBounds {
    const castLength = preset.castHeightPx * preset.stretch * profile.lengthMult;
    const softness = preset.softnessPx * profile.softnessMult;
    const inflate = preset.inflatePx + softness;
    const radius = Math.max(
      preset.footprintWidthPx + inflate * 2,
      preset.footprintHeightPx + inflate * 2,
    ) * 0.5;
    const offset = (preset.airborneHeightPx ?? 0) + castLength;
    const dx = WORLD_SHADOW_CONFIG.lightDirection.x * offset;
    const dy = WORLD_SHADOW_CONFIG.lightDirection.y * offset;
    return {
      minX: Math.min(x, x + dx) - radius,
      minY: Math.min(y, y + dy) - radius,
      maxX: Math.max(x, x + dx) + radius,
      maxY: Math.max(y, y + dy) + radius,
    };
  }

  private shadowBoundsIntersectChunk(
    x: number,
    y: number,
    preset: ShadowCasterConfig,
    chunk: ShadowDirtyChunk,
    profile: ShadowProfile,
  ): boolean {
    const bounds = this.getShadowBounds(x, y, preset, profile);
    return bounds.maxX > chunk.x
      && bounds.minX < chunk.x + SHADOW_DIRTY_CHUNK_SIZE
      && bounds.maxY > chunk.y
      && bounds.minY < chunk.y + SHADOW_DIRTY_CHUNK_SIZE;
  }

  syncDynamicShadows(
    players: readonly PlayerEntity[],
    projectiles: readonly ShadowProjectileSample[],
    train: SyncedTrainState | null,
  ): void {
    this.clearDynamic();

    // In `low` entfallen die Schatten bewegter Werfer komplett. Sie sind der einzige
    // Schattenanteil, der sich nicht backen laesst, und werden jeden Frame als gestapelte
    // Alpha-Fuellungen neu gezeichnet. `clearDynamic()` lief bereits – der Layer ist also leer.
    if (!this.quality.dynamicShadows) return;

    for (const player of players) {
      const sprite = player.sprite;
      if (!sprite.active || !sprite.visible) continue;
      if (player.isDecoyStealthedVisual()) continue;
      const burrowPhase = player.getBurrowPhase();
      if (burrowPhase === 'underground' || burrowPhase === 'trapped') continue;

      this.drawFootprint(
        this.getLayer(SHADOW_CASTERS.player.layerDepth).dynamicGraphics,
        sprite.x,
        sprite.y,
        SHADOW_CASTERS.player,
        SHADOW_CASTERS.player.footprintWidthPx * Math.abs(sprite.scaleX || 1),
        SHADOW_CASTERS.player.footprintHeightPx * Math.abs(sprite.scaleY || 1),
      );
    }

    for (const projectile of projectiles) {
      if (!this.quality.projectileShadows) break;
      const preset = getProjectileShadowConfig(projectile.style);
      if (!preset?.enabled) continue;

      const sizeScale = Phaser.Math.Clamp(projectile.size / 18, 0.75, 1.45);
      this.drawFootprint(
        this.getLayer(preset.layerDepth).dynamicGraphics,
        projectile.x,
        projectile.y,
        preset,
        preset.footprintWidthPx * sizeScale,
        preset.footprintHeightPx * sizeScale,
      );
    }

    if (train?.alive) {
      this.drawTrainShadow(train);
    }
  }

  clear(): void {
    this.clearStatic();
    this.clearDynamic();
    this.shadowsVisible = true;
    this.staticSamplingMode = 'default';
    this.setDynamicVisible(true);
    this.lastStaticLayout = null;
    this.lastStaticOptions = {};
    this.lastBakedProfile = null;
    this.lastStaticProfileBakeAtMs = Number.NEGATIVE_INFINITY;
  }

  destroy(): void {
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.destroy();
      bucket.dynamicGraphics.destroy();
    }
    this.layers.clear();
    this.disposeStaticSurface();
    this.staticScratch.destroy();
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.lastStaticLayout = null;
    this.lastStaticOptions = {};
    this.lastBakedProfile = null;
    this.lastStaticProfileBakeAtMs = Number.NEGATIVE_INFINITY;
  }

  /**
   * Leert Zeichenpuffer **und** gebackene Chunks. Beides muss zusammen passieren: Den Puffer
   * allein zu leeren liesse die gebackenen Schatten stehen – sie ueberlebten dann den
   * Arena-Teardown und blieben als Raster in der Lobby sichtbar.
   */
  private clearStatic(): void {
    for (const bucket of this.layers.values()) bucket.staticGraphics.clear();
    this.staticHasLayout = false;
    // Verwerfen statt Weisszeichnen: Ohne Layout gibt es nichts zu backen, und die Renderziele
    // waeren nur ein neutraler Vollflaechen-Blendpass pro Frame.
    this.disposeStaticSurface();
  }

  private clearDynamic(): void {
    for (const bucket of this.layers.values()) {
      bucket.dynamicGraphics.clear();
    }
  }

  private drawTrainShadow(train: SyncedTrainState): void {
    const locoPreset = SHADOW_CASTERS.trainLoco;
    const wagonPreset = SHADOW_CASTERS.trainWagon;
    const yPositions = this.computeTrainSegmentYs(train.y, train.dir);

    this.drawFootprint(
      this.getLayer(locoPreset.layerDepth).dynamicGraphics,
      train.x,
      yPositions[0],
      locoPreset,
      locoPreset.footprintWidthPx,
      locoPreset.footprintHeightPx,
    );

    for (let index = 1; index < yPositions.length; index += 1) {
      this.drawFootprint(
        this.getLayer(wagonPreset.layerDepth).dynamicGraphics,
        train.x,
        yPositions[index],
        wagonPreset,
        wagonPreset.footprintWidthPx,
        wagonPreset.footprintHeightPx,
      );
    }
  }

  private computeTrainSegmentYs(locoY: number, direction: 1 | -1): number[] {
    // Avoid new Array().fill() — all wagon heights are identical (WAGON_HEIGHT).
    const ys: number[] = [locoY];
    let previousY = locoY;

    // Loco → first wagon
    const firstGap = TRAIN.LOCO_HEIGHT / 2 + TRAIN.SEGMENT_GAP + TRAIN.WAGON_HEIGHT / 2;
    previousY -= direction * firstGap;
    ys.push(previousY);

    // Remaining wagons (wagon → wagon gap is constant)
    const wagonGap = TRAIN.WAGON_HEIGHT + TRAIN.SEGMENT_GAP;
    for (let index = 1; index < TRAIN.WAGON_COUNT; index += 1) {
      previousY -= direction * wagonGap;
      ys.push(previousY);
    }

    return ys;
  }

  private drawFootprint(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    preset: ShadowCasterConfig,
    width = preset.footprintWidthPx,
    height = preset.footprintHeightPx,
    profile = this.profile,
  ): void {
    // Profil-Multiplikatoren (Tag/Nacht) skalieren Länge, Deckkraft und Weichheit;
    // die Lichtrichtung bleibt konstant, siehe SHADOW_PROFILES.
    const castLength = preset.castHeightPx * preset.stretch * profile.lengthMult;
    const softnessPx = preset.softnessPx * profile.softnessMult;

    const maxExtent = Math.max(width, height) * 0.5
      + (preset.airborneHeightPx ?? 0)
      + castLength
      + softnessPx
      + 16;
    if (!this.isVisibleInArena(x, y, maxExtent)) return;

    const steps = Math.max(1, Math.round(preset.blurLayers * this.quality.shadowLayerFactor));
    const denominator = Math.max(1, steps - 1);
    const dir = WORLD_SHADOW_CONFIG.lightDirection;
    const airborneHeight = preset.airborneHeightPx ?? 0;

    // Fixed directional offset for all layers.
    const offsetScale = airborneHeight + castLength;
    const dx = dir.x * offsetScale;
    const dy = dir.y * offsetScale;
    const drawX = x + dx;
    const drawY = y + dy;

    for (let step = steps - 1; step >= 0; step -= 1) {
      const t = step / denominator;
      const inflate = preset.inflatePx + softnessPx * t;
      const alpha = preset.opacity * profile.opacityMult * (1 - t * 0.88) / steps;
      const drawWidth = Math.max(1, width + inflate * 2);
      const drawHeight = Math.max(1, height + inflate * 2);

      // Grounded casters use projection shapes (convex hull of source + shadow)
      // so the shadow reads as a single directional form rather than a detached copy.
      // Airborne casters keep the simple offset shape since the gap is intentional.
      if (airborneHeight === 0 && preset.shape === 'cell') {
        this.fillCellProjection(graphics, x, y, drawWidth, drawHeight, dx, dy, alpha);
      } else if (airborneHeight === 0 && (preset.shape === 'circle' || preset.shape === 'ellipse')) {
        const radius = Math.max(drawWidth, drawHeight) * 0.5;
        this.fillStadiumShadow(graphics, x, y, radius, dx, dy, alpha);
      } else {
        this.fillShape(graphics, preset.shape, drawX, drawY, drawWidth, drawHeight, alpha);
      }
    }
  }

  // Draws the convex hull of two circles as a single closed polygon (stadium).
  // Uses pre-computed arc tables (no trig per call) and a reusable point buffer
  // (no allocations per call) for zero GC pressure on the hot dynamic path.
  private fillStadiumShadow(
    graphics: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    radius: number,
    dx: number,
    dy: number,
    alpha: number,
  ): void {
    graphics.fillStyle(WORLD_SHADOW_CONFIG.color, alpha);
    if (dx * dx + dy * dy < 0.25) {
      graphics.fillCircle(cx, cy, radius);
      return;
    }

    const pts = this.stadiumPts;
    const N = STADIUM_ARC_N;
    // Back cap — source semicircle (pre-computed angles, no trig here)
    for (let i = 0; i <= N; i++) {
      const arc = STADIUM_BACK_ARC[i];
      pts[i].x = cx + arc.cos * radius;
      pts[i].y = cy + arc.sin * radius;
    }
    // Front cap — shadow semicircle
    for (let i = 0; i <= N; i++) {
      const arc = STADIUM_FRONT_ARC[i];
      pts[N + 1 + i].x = cx + dx + arc.cos * radius;
      pts[N + 1 + i].y = cy + dy + arc.sin * radius;
    }

    graphics.fillPoints(pts, true);
  }

  // Draws the convex hull of the source rect (at cx,cy) and the shadow rect
  // (at cx+dx, cy+dy), both with the given width/height. For a diagonal offset
  // this produces a hexagon that looks like a natural directional shadow rather
  // than two perpendicular 90° strips sticking out from under the caster.
  private fillCellProjection(
    graphics: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    width: number,
    height: number,
    dx: number,
    dy: number,
    alpha: number,
  ): void {
    const hw = width / 2;
    const hh = height / 2;

    // Convex hull of source rect (at cx,cy) and shadow rect (at cx+dx, cy+dy).
    // lightDirection is always {x>0, y>0}, so the shadow goes bottom-right and
    // the hull is always this clockwise hexagon:
    //   source-TL → source-TR → shadow-TR → shadow-BR → shadow-BL → source-BL
    const p = this.cellPts;
    p[0].x = cx - hw;      p[0].y = cy - hh;        // source TL
    p[1].x = cx + hw;      p[1].y = cy - hh;        // source TR
    p[2].x = cx + hw + dx; p[2].y = cy - hh + dy;   // shadow TR
    p[3].x = cx + hw + dx; p[3].y = cy + hh + dy;   // shadow BR
    p[4].x = cx - hw + dx; p[4].y = cy + hh + dy;   // shadow BL
    p[5].x = cx - hw;      p[5].y = cy + hh;        // source BL

    graphics.fillStyle(WORLD_SHADOW_CONFIG.color, alpha);
    graphics.fillPoints(p, true);
  }

  private fillShape(
    graphics: Phaser.GameObjects.Graphics,
    shape: ShadowCasterConfig['shape'],
    x: number,
    y: number,
    width: number,
    height: number,
    alpha: number,
  ): void {
    graphics.fillStyle(WORLD_SHADOW_CONFIG.color, alpha);

    switch (shape) {
      case 'cell':
        graphics.fillRect(x - width / 2, y - height / 2, width, height);
        return;
      case 'circle':
        graphics.fillCircle(x, y, Math.max(width, height) * 0.5);
        return;
      case 'capsule': {
        const radius = Math.min(width, height) * 0.46;
        graphics.fillRoundedRect(x - width / 2, y - height / 2, width, height, radius);
        return;
      }
      case 'ellipse':
      default:
        graphics.fillEllipse(x, y, width, height);
    }
  }

  private getLayer(depth: number, group: StaticShadowGroup | null = null): ShadowLayerBucket {
    const key = depth.toFixed(3);
    const existing = this.layers.get(key);
    if (existing) {
      if (group) existing.group = group;
      return existing;
    }

    // Der statische Puffer wird gebacken und nie selbst gerendert: keine Maske noetig, die
    // traegt stattdessen die RenderTexture.
    const staticGraphics = this.scene.add.graphics();
    staticGraphics.setDepth(depth);
    staticGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);
    staticGraphics.setVisible(false);

    const dynamicGraphics = this.scene.add.graphics();
    dynamicGraphics.setDepth(depth + 0.001);
    dynamicGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);

    const bucket: ShadowLayerBucket = { staticGraphics, dynamicGraphics, group };
    this.layers.set(key, bucket);
    return bucket;
  }

  private isVisibleInArena(x: number, y: number, margin: number): boolean {
    const bounds = this.worldBoundsOverride ?? WORLD_SHADOW_CONFIG.arenaBounds;
    return x + margin >= bounds.minX
      && x - margin <= bounds.maxX
      && y + margin >= bounds.minY
      && y - margin <= bounds.maxY;
  }
}

function hasRelevantStaticProfileChange(from: ShadowProfile, to: ShadowProfile): boolean {
  return Math.abs(from.opacityMult - to.opacityMult) >= STATIC_PROFILE_OPACITY_DELTA
    || Math.abs(from.lengthMult - to.lengthMult) >= STATIC_PROFILE_LENGTH_DELTA
    || Math.abs(from.softnessMult - to.softnessMult) >= STATIC_PROFILE_SOFTNESS_DELTA;
}
