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
  readonly staticGraphics: Phaser.GameObjects.Graphics;
  readonly dynamicGraphics: Phaser.GameObjects.Graphics;
  /**
   * Die statischen Footprints werden einmalig in diese RenderTexture gebacken; `staticGraphics`
   * dient danach nur noch als Zeichenpuffer und bleibt unsichtbar. Ohne das Backen rastert die
   * GPU pro Frame alle gestapelten Alpha-Fuellungen neu – bei Fels 8 und Krone 32 Lagen je
   * Schattenwerfer ist das der groesste gemessene Einzelposten im Frame.
   */
  baked: Phaser.GameObjects.RenderTexture | null;
  group: StaticShadowGroup | null;
  /**
   * Ob die gebackene Textur gerade Schatten enthaelt. Eine geleerte Textur ist rein weiss und
   * damit fuer MULTIPLY wirkungslos – sie wird dennoch ausgeblendet, damit sie keine
   * Vollflaechen-Blendpass pro Frame kostet.
   */
  bakedHasContent: boolean;
}

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
  private quality: GraphicsQualityProfile;
  private unsubscribeQuality: (() => void) | null = null;
  private lastStaticLayout: ArenaLayout | null = null;
  private lastStaticOptions: StaticShadowLayoutBuildOptions = {};
  /** Von aussen gesetzte Sichtbarkeit; kombiniert sich mit dem Inhalt der gebackenen Layer. */
  private shadowsVisible = true;

  // Reusable point buffers — mutated in-place each draw call to avoid
  // allocating hundreds of Vector2 objects per frame.
  private readonly stadiumPts: Phaser.Math.Vector2[] =
    Array.from({ length: (STADIUM_ARC_N + 1) * 2 }, () => new Phaser.Math.Vector2());
  private readonly cellPts: Phaser.Math.Vector2[] =
    Array.from({ length: 6 }, () => new Phaser.Math.Vector2());

  constructor(
    private readonly scene: Phaser.Scene,
    private arenaMask: Phaser.Display.Masks.GeometryMask | null = null,
  ) {
    this.quality = getGraphicsQualityProfile(scene);
    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe((profile) => {
      this.quality = profile;
      if (this.lastStaticLayout) {
        this.rebuildStaticLayoutShadows(this.lastStaticLayout, this.lastStaticOptions);
      }
    }) ?? null;
  }

  setArenaMask(mask: Phaser.Display.Masks.GeometryMask | null): void {
    this.arenaMask = mask;
    for (const bucket of this.layers.values()) {
      // `staticGraphics` rendert nie selbst; die Maske traegt die gebackene Textur.
      if (bucket.baked) this.applyMask(bucket.baked);
      this.applyMask(bucket.dynamicGraphics);
    }
  }

  setWorldBoundsOverride(bounds: ShadowWorldBounds | null): void {
    this.worldBoundsOverride = bounds;
  }

  /**
   * Wählt die Tag- oder Nachtvariante. Nachts bleiben die Sonnenschatten erhalten,
   * werden aber zu kurzen, weichen und blassen Mondschatten. Vor einem Rebuild der
   * statischen Layer setzen – dynamische Schatten übernehmen es ab dem nächsten Frame.
   */
  setProfile(profileId: 'day' | 'night'): void {
    this.profile = SHADOW_PROFILES[profileId];
  }

  setVisible(visible: boolean): void {
    this.shadowsVisible = visible;
    for (const bucket of this.layers.values()) {
      // `staticGraphics` bleibt dauerhaft unsichtbar – sichtbar ist die gebackene Textur.
      this.syncBakedVisibility(bucket);
      bucket.dynamicGraphics.setVisible(visible);
    }
  }

  private syncBakedVisibility(bucket: ShadowLayerBucket): void {
    bucket.baked?.setVisible(this.shadowsVisible && bucket.bakedHasContent);
  }

  rebuildStaticLayoutShadows(
    layout: ArenaLayout | null,
    options: StaticShadowLayoutBuildOptions = {},
  ): void {
    this.lastStaticLayout = layout;
    this.lastStaticOptions = options;
    if (!layout) {
      this.clearStatic();
      return;
    }
    this.rebuildStaticRockShadows(layout, options);
    this.rebuildStaticTreeShadows(layout, options);
  }

  /**
   * Fels- und Turret-Schatten. Als einzige statische Gruppe veraenderlich, weil Felsen
   * zerstoert und Turrets gesetzt werden – deshalb eine eigene Gruppe mit eigenem Bake.
   */
  private rebuildStaticRockShadows(layout: ArenaLayout, options: StaticShadowLayoutBuildOptions): void {
    this.clearStaticGroup('rocks');

    const runtimeById = new Map<number, SyncedPlaceableRock>();
    for (const rock of options.runtimeRocks ?? []) {
      runtimeById.set(rock.id, rock);
    }

    const offsetX = options.offsetX ?? ARENA_OFFSET_X;
    const offsetY = options.offsetY ?? ARENA_OFFSET_Y;
    const rockVisibilityPredicate = options.rockVisibilityPredicate ?? (() => true);

    for (let id = 0; id < layout.rocks.length; id += 1) {
      if (!rockVisibilityPredicate(id)) continue;

      const cell = layout.rocks[id];
      const runtime = runtimeById.get(id);
      const preset = runtime?.kind === 'turret' ? SHADOW_CASTERS.turret : SHADOW_CASTERS.rock;
      const worldX = offsetX + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = offsetY + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
      this.drawFootprint(this.getLayer(preset.layerDepth, 'rocks').staticGraphics, worldX, worldY, preset);
    }

    this.bakeStaticGroup('rocks');
  }

  /**
   * Baum-Schatten. `layout.trees` kennt kein Sichtbarkeits-Praedikat – Baeume werden nie
   * entfernt, die Gruppe ist also unveraenderlich und wird nach dem Aufbau nie neu gebacken.
   * Gleichzeitig ist sie die teuerste: die Krone stapelt 32 Lagen.
   */
  private rebuildStaticTreeShadows(layout: ArenaLayout, options: StaticShadowLayoutBuildOptions): void {
    this.clearStaticGroup('trees');

    const offsetX = options.offsetX ?? ARENA_OFFSET_X;
    const offsetY = options.offsetY ?? ARENA_OFFSET_Y;

    for (const tree of layout.trees) {
      const worldX = offsetX + tree.gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = offsetY + tree.gridY * CELL_SIZE + CELL_SIZE / 2;
      this.drawFootprint(this.getLayer(SHADOW_CASTERS.trunk.layerDepth, 'trees').staticGraphics, worldX, worldY, SHADOW_CASTERS.trunk);
      this.drawFootprint(this.getLayer(SHADOW_CASTERS.canopy.layerDepth, 'trees').staticGraphics, worldX, worldY, SHADOW_CASTERS.canopy);
    }

    this.bakeStaticGroup('trees');
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
    // Solange dasselbe Layout gilt, koennen die Baum-Schatten stehen bleiben – sie sind
    // unveraenderlich und mit 32 Lagen je Krone der teuerste Teil des Bakes.
    const sameLayout = this.lastStaticLayout === layout;
    this.lastStaticLayout = layout;
    this.lastStaticOptions = options;
    if (sameLayout) {
      this.rebuildStaticRockShadows(layout, options);
      return;
    }
    this.rebuildStaticRockShadows(layout, options);
    this.rebuildStaticTreeShadows(layout, options);
  }

  syncDynamicShadows(
    players: readonly PlayerEntity[],
    projectiles: readonly ShadowProjectileSample[],
    train: SyncedTrainState | null,
  ): void {
    this.clearDynamic();

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
    this.lastStaticLayout = null;
    this.lastStaticOptions = {};
  }

  destroy(): void {
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.destroy();
      bucket.dynamicGraphics.destroy();
      bucket.baked?.destroy();
    }
    this.layers.clear();
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.lastStaticLayout = null;
    this.lastStaticOptions = {};
  }

  /**
   * Leert Zeichenpuffer **und** gebackene Texturen. Beides muss zusammen passieren: Der Puffer
   * allein zu leeren liesse die gebackenen Schatten stehen – sie ueberlebten dann den
   * Arena-Teardown und blieben als Raster in der Lobby sichtbar.
   */
  private clearStatic(): void {
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.clear();
      if (bucket.baked) {
        bucket.baked.clear();
        bucket.baked.fill(0xffffff, 1);
        bucket.baked.render();
      }
      bucket.bakedHasContent = false;
      this.syncBakedVisibility(bucket);
    }
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
  ): void {
    // Profil-Multiplikatoren (Tag/Nacht) skalieren Länge, Deckkraft und Weichheit;
    // die Lichtrichtung bleibt konstant, siehe SHADOW_PROFILES.
    const profile = this.profile;
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
    this.applyMask(dynamicGraphics);

    const bucket: ShadowLayerBucket = { staticGraphics, dynamicGraphics, baked: null, group, bakedHasContent: false };
    this.layers.set(key, bucket);
    return bucket;
  }

  /**
   * Backt den statischen Puffer einer Ebene in eine RenderTexture.
   *
   * Die Textur startet **deckend weiss** und die Footprints werden mit ihrem
   * MULTIPLY-Blendmode hineingezeichnet. Damit enthaelt sie exakt das Produkt der gestapelten
   * Lagen, und ein abschliessendes MULTIPLY der Textur auf die Szene ergibt dasselbe Bild wie
   * das bisherige Stapeln direkt auf die Szene. Weiss ist dabei das neutrale Element – ausserhalb
   * der Schatten aendert die Textur nichts. Normales Alpha-Blending waere hier *nicht*
   * gleichwertig, weil die Schattenfarbe (0x05070b) nicht exakt schwarz ist.
   */
  private bakeLayer(depth: number, bucket: ShadowLayerBucket): void {
    const bounds = this.worldBoundsOverride ?? WORLD_SHADOW_CONFIG.arenaBounds;
    const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
    const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));

    let baked = bucket.baked;
    if (!baked) {
      baked = this.scene.add.renderTexture(bounds.minX, bounds.minY, width, height);
      baked.setOrigin(0, 0);
      baked.setDepth(depth);
      baked.setBlendMode(Phaser.BlendModes.MULTIPLY);
      baked.camera.setScroll(bounds.minX, bounds.minY);
      this.applyMask(baked);
      bucket.baked = baked;
    }

    baked.clear();
    baked.fill(0xffffff, 1);
    // draw() rendert das Objekt mit seinem eigenen Blendmode; sichtbar muss es dafuer sein.
    bucket.staticGraphics.setVisible(true);
    baked.draw(bucket.staticGraphics);
    bucket.staticGraphics.setVisible(false);
    baked.render();
    bucket.bakedHasContent = true;
    this.syncBakedVisibility(bucket);
  }

  /** Zeichenpuffer und gebackene Textur einer Gruppe zuruecksetzen. */
  private clearStaticGroup(group: StaticShadowGroup): void {
    for (const bucket of this.layers.values()) {
      if (bucket.group !== group) continue;
      bucket.staticGraphics.clear();
    }
  }

  private bakeStaticGroup(group: StaticShadowGroup): void {
    for (const [key, bucket] of this.layers) {
      if (bucket.group !== group) continue;
      this.bakeLayer(Number(key), bucket);
    }
  }

  private applyMask(target: Phaser.GameObjects.Graphics | Phaser.GameObjects.RenderTexture): void {
    if (this.arenaMask) {
      target.setMask(this.arenaMask);
    } else {
      target.clearMask(false);
    }
  }

  private isVisibleInArena(x: number, y: number, margin: number): boolean {
    const bounds = this.worldBoundsOverride ?? WORLD_SHADOW_CONFIG.arenaBounds;
    return x + margin >= bounds.minX
      && x - margin <= bounds.maxX
      && y + margin >= bounds.minY
      && y - margin <= bounds.maxY;
  }
}
