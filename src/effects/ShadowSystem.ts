import Phaser from 'phaser';
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
  type ShadowCasterConfig,
  type ShadowProjectileSample,
  WORLD_SHADOW_CONFIG,
} from './ShadowConfig';

interface ShadowLayerBucket {
  readonly staticGraphics: Phaser.GameObjects.Graphics;
  readonly dynamicGraphics: Phaser.GameObjects.Graphics;
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

  // Reusable point buffers — mutated in-place each draw call to avoid
  // allocating hundreds of Phaser.Geom.Point objects per frame.
  private readonly stadiumPts: Array<{ x: number; y: number }> =
    Array.from({ length: (STADIUM_ARC_N + 1) * 2 }, () => ({ x: 0, y: 0 }));
  private readonly cellPts: Array<{ x: number; y: number }> =
    Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));

  constructor(
    private readonly scene: Phaser.Scene,
    private arenaMask: Phaser.Display.Masks.GeometryMask | null = null,
  ) {}

  setArenaMask(mask: Phaser.Display.Masks.GeometryMask | null): void {
    this.arenaMask = mask;
    for (const bucket of this.layers.values()) {
      this.applyMask(bucket.staticGraphics);
      this.applyMask(bucket.dynamicGraphics);
    }
  }

  rebuildArenaStaticShadows(
    layout: ArenaLayout | null,
    arenaResult: ArenaBuilderResult | null,
    runtimeRocks: readonly SyncedPlaceableRock[] = [],
  ): void {
    this.clearStatic();
    if (!layout || !arenaResult) return;

    const runtimeById = new Map<number, SyncedPlaceableRock>();
    for (const rock of runtimeRocks) {
      runtimeById.set(rock.id, rock);
    }

    for (let id = 0; id < layout.rocks.length; id += 1) {
      const rockObject = arenaResult.rockObjects[id];
      if (!rockObject?.active) continue;

      const cell = layout.rocks[id];
      const runtime = runtimeById.get(id);
      const preset = runtime?.kind === 'turret' ? SHADOW_CASTERS.turret : SHADOW_CASTERS.rock;
      const worldX = ARENA_OFFSET_X + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
      this.drawFootprint(this.getLayer(preset.layerDepth).staticGraphics, worldX, worldY, preset);
    }

    for (const tree of layout.trees) {
      const worldX = ARENA_OFFSET_X + tree.gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + tree.gridY * CELL_SIZE + CELL_SIZE / 2;
      this.drawFootprint(this.getLayer(SHADOW_CASTERS.trunk.layerDepth).staticGraphics, worldX, worldY, SHADOW_CASTERS.trunk);
      this.drawFootprint(this.getLayer(SHADOW_CASTERS.canopy.layerDepth).staticGraphics, worldX, worldY, SHADOW_CASTERS.canopy);
    }
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
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.clear();
      bucket.dynamicGraphics.clear();
    }
  }

  destroy(): void {
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.destroy();
      bucket.dynamicGraphics.destroy();
    }
    this.layers.clear();
  }

  private clearStatic(): void {
    for (const bucket of this.layers.values()) {
      bucket.staticGraphics.clear();
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
    const maxExtent = Math.max(width, height) * 0.5
      + (preset.airborneHeightPx ?? 0)
      + preset.castHeightPx * preset.stretch
      + preset.softnessPx
      + 16;
    if (!this.isVisibleInArena(x, y, maxExtent)) return;

    const steps = Math.max(1, preset.blurLayers);
    const denominator = Math.max(1, steps - 1);
    const dir = WORLD_SHADOW_CONFIG.lightDirection;
    const airborneHeight = preset.airborneHeightPx ?? 0;

    // Fixed directional offset for all layers.
    const offsetScale = airborneHeight + preset.castHeightPx * preset.stretch;
    const dx = dir.x * offsetScale;
    const dy = dir.y * offsetScale;
    const drawX = x + dx;
    const drawY = y + dy;

    for (let step = steps - 1; step >= 0; step -= 1) {
      const t = step / denominator;
      const inflate = preset.inflatePx + preset.softnessPx * t;
      const alpha = preset.opacity * (1 - t * 0.88) / steps;
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

  private getLayer(depth: number): ShadowLayerBucket {
    const key = depth.toFixed(3);
    const existing = this.layers.get(key);
    if (existing) return existing;

    const staticGraphics = this.scene.add.graphics();
    staticGraphics.setDepth(depth);
    staticGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.applyMask(staticGraphics);

    const dynamicGraphics = this.scene.add.graphics();
    dynamicGraphics.setDepth(depth + 0.001);
    dynamicGraphics.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.applyMask(dynamicGraphics);

    const bucket: ShadowLayerBucket = { staticGraphics, dynamicGraphics };
    this.layers.set(key, bucket);
    return bucket;
  }

  private applyMask(graphics: Phaser.GameObjects.Graphics): void {
    if (this.arenaMask) {
      graphics.setMask(this.arenaMask);
    } else {
      graphics.clearMask(false);
    }
  }

  private isVisibleInArena(x: number, y: number, margin: number): boolean {
    const bounds = WORLD_SHADOW_CONFIG.arenaBounds;
    return x + margin >= bounds.minX
      && x - margin <= bounds.maxX
      && y + margin >= bounds.minY
      && y - margin <= bounds.maxY;
  }
}