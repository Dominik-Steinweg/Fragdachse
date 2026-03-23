import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  DEPTH, COLORS,
  CELL_SIZE, TRUNK_RADIUS, CANOPY_RADIUS, CANOPY_ALPHA_PLAYER, ROCK_HP_MAX, ROCK_TINT_STEPS,
} from '../config';
import type { ArenaLayout, RockCell, TrackCell, DirtCell } from '../types';
import { AutoTiler, ROCK_AUTOTILE, DIRT_AUTOTILE } from './AutoTiler';
import { RockGridIndex } from './RockGridIndex';

export interface ArenaBuilderResult {
  /** StaticGroup mit Felsen-Sprites (für Kollision + HP-Tracking) */
  rockGroup:    Phaser.Physics.Arcade.StaticGroup;
  /** Paralleles Array zu layout.rocks – null-Slots = bereits zerstört */
  rockObjects:  (Phaser.GameObjects.Image | null)[];
  /** Spatial Index für Grid-basierte Nachbar-Lookups (Autotiling) */
  rockGrid:     RockGridIndex;
  /** StaticGroup mit Baumstümpfen (Kreis-Körper, keine HP) */
  trunkGroup:   Phaser.Physics.Arcade.StaticGroup;
  /** Baumstumpf-Objekte für Hitscan-/Melee-Sweeps */
  trunkObjects: Phaser.GameObjects.Arc[];
  /** Baumkronen-Sprites für Transparenz-Update */
  canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }>;
  /** Gleis-TileSprites (eine pro Gleis-Spalte, nur visuell, keine Kollision) */
  trackObjects: Phaser.GameObjects.TileSprite[];
  /** Dirt-Sprites (rein visuell, keine Kollision, keine HP) */
  dirtObjects: Phaser.GameObjects.Image[];
}

export class ArenaBuilder {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Statische Teile (einmalig in create()) ─────────────────────────────────

  /** Zeichnet Sidebars, Gras und setzt die Physics-Bounds.
   *  Wird einmalig in ArenaScene.create() aufgerufen, nie zerstört. */
  buildStatic(): void {
    this.drawSidebars();
    this.drawGrass();
    this.setPhysicsBounds();
  }

  // ── Dynamische Teile (einmal pro Runde) ────────────────────────────────────

  /**
   * Baut Felsen und Bäume anhand des übergebenen Layouts.
   * Wird pro Runde einmalig aufgerufen. Rückgabe muss in ArenaScene
   * gespeichert werden; `destroy()` räumt alles wieder auf.
   */
  buildDynamic(layout: ArenaLayout): ArenaBuilderResult {
    const rockGroup    = this.scene.physics.add.staticGroup();
    const trunkGroup   = this.scene.physics.add.staticGroup();
    const rockObjects:  (Phaser.GameObjects.Image | null)[] = [];
    const trunkObjects: Phaser.GameObjects.Arc[] = [];
    const canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }> = [];

    // Spatial Index für Autotiling
    const rockGrid = new RockGridIndex(layout.rocks);
    const isOccupied = (gx: number, gy: number) => rockGrid.isOccupied(gx, gy);

    // Gleise (vor Felsen zeichnen, damit depth-Reihenfolge stimmt)
    const trackObjects = this.buildTracks(layout.tracks ?? []);

    // Dirt (rein visuell, keine Physik)
    const dirtObjects = this.buildDirt(layout.dirt ?? []);

    // Felsen mit Autotiling
    for (let i = 0; i < layout.rocks.length; i++) {
      const { gridX, gridY } = layout.rocks[i];
      const worldX = ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2;
      const mask   = AutoTiler.computeMask(gridX, gridY, isOccupied);
      const frame  = AutoTiler.getFrame(mask, ROCK_AUTOTILE);
      const img    = this.createRockVisual(worldX, worldY, frame);
      rockGroup.add(img);
      (img.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      rockObjects.push(img);
    }

    // Bäume (Trunk + Canopy)
    for (const { gridX, gridY } of layout.trees) {
      const worldX = ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2;

      // Trunk (Kollision)
      const trunk = this.createTrunkVisual(worldX, worldY);
      trunkGroup.add(trunk);
      const trunkBody = trunk.body as Phaser.Physics.Arcade.StaticBody;
      trunkBody.setCircle(TRUNK_RADIUS);
      trunkBody.updateFromGameObject();
      trunkObjects.push(trunk);

      // Canopy (nur visuell)
      const gfx = this.createCanopyVisual(worldX, worldY);
      canopyObjects.push({ gfx, worldX, worldY });
    }

    return { rockGroup, rockObjects, rockGrid, trunkGroup, trunkObjects, canopyObjects, trackObjects, dirtObjects };
  }

  // ── Canopy-Transparenz (jeden Frame lokal) ─────────────────────────────────

  /**
   * Setzt Alpha der Baumkrone auf CANOPY_ALPHA_PLAYER wenn sich der lokale
   * Spieler darunter befindet. Nur lokal – keine Netzwerkauswirkungen.
   */
  static updateCanopyTransparency(
    canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }>,
    localSprite:   Phaser.GameObjects.GameObject & { x: number; y: number } | null,
  ): void {
    for (const { gfx, worldX, worldY } of canopyObjects) {
      if (!gfx.active) continue;
      const dx     = (localSprite?.x ?? -9999) - worldX;
      const dy     = (localSprite?.y ?? -9999) - worldY;
      const inside = Math.sqrt(dx * dx + dy * dy) < CANOPY_RADIUS;
      gfx.setAlpha(inside ? CANOPY_ALPHA_PLAYER : 1.0);
    }
  }

  // ── Rock-Visual-Updates ────────────────────────────────────────────────────

  /**
   * Aktualisiert Tint eines Felsens anhand seines HP-Wertes.
   * Bei hp <= 0 wird der Fels zerstört und Nachbar-Tiles aktualisiert.
   */
  static updateRockVisual(
    rockObjects: (Phaser.GameObjects.Image | null)[],
    rockGroup:   Phaser.Physics.Arcade.StaticGroup,
    rockGrid:    RockGridIndex,
    rocks:       readonly RockCell[],
    id:          number,
    hp:          number,
  ): void {
    if (hp <= 0) {
      ArenaBuilder.destroyRockAndRetile(rockObjects, rockGroup, rockGrid, rocks, id);
      return;
    }
    const img = rockObjects[id];
    if (!img?.active) return;

    // Glatte Abstufung in ROCK_TINT_STEPS Schritten: 0xffffff (voll) → 0x666666 (fast zerstört)
    const ratio = Math.round((hp / ROCK_HP_MAX) * ROCK_TINT_STEPS) / ROCK_TINT_STEPS;
    const gray  = Math.round(0x66 + (0xFF - 0x66) * ratio);
    img.setTint((gray << 16) | (gray << 8) | gray);
  }

  /**
   * Entfernt einen Fels und aktualisiert die Tile-Frames aller Nachbarn.
   */
  static destroyRockAndRetile(
    rockObjects: (Phaser.GameObjects.Image | null)[],
    rockGroup:   Phaser.Physics.Arcade.StaticGroup,
    rockGrid:    RockGridIndex,
    rocks:       readonly RockCell[],
    id:          number,
  ): void {
    const { gridX, gridY } = rocks[id];
    ArenaBuilder.destroyRock(rockObjects, rockGroup, id);
    rockGrid.remove(gridX, gridY);

    // Nachbar-Tiles neu berechnen
    const isOccupied = (gx: number, gy: number) => rockGrid.isOccupied(gx, gy);
    const neighborIds = rockGrid.getNeighborIndices(gridX, gridY);
    for (const nid of neighborIds) {
      const img = rockObjects[nid];
      if (!img?.active) continue;
      const { gridX: ngx, gridY: ngy } = rocks[nid];
      const mask  = AutoTiler.computeMask(ngx, ngy, isOccupied);
      const frame = AutoTiler.getFrame(mask, ROCK_AUTOTILE);
      img.setFrame(frame);
    }
  }

  /**
   * Entfernt einen Fels physikalisch und visuell aus der Szene.
   * Sicher mehrfach aufzurufen (idempotent via null-Slot).
   */
  static destroyRock(
    rockObjects: (Phaser.GameObjects.Image | null)[],
    rockGroup:   Phaser.Physics.Arcade.StaticGroup,
    id:          number,
  ): void {
    const img = rockObjects[id];
    if (!img) return;
    rockGroup.remove(img, true, true);
    rockGroup.refresh();
    rockObjects[id] = null;
  }

  // ── Teardown ────────────────────────────────────────────────────────────────

  /**
   * Zerstört alle dynamisch erstellten Objekte (Felsen, Trunks, Canopies).
   * Sidebars/Gras bleiben erhalten (diese sind statisch).
   */
  static destroyDynamic(result: ArenaBuilderResult): void {
    // Felsen
    for (const img of result.rockObjects) {
      if (img?.active) img.destroy();
    }
    result.rockObjects.length = 0;
    result.rockGroup.destroy(true);

    // Trunks
    for (const trunk of result.trunkObjects) {
      if (trunk.active) trunk.destroy();
    }
    result.trunkObjects.length = 0;
    result.trunkGroup.destroy(true);

    // Canopies
    for (const { gfx } of result.canopyObjects) {
      if (gfx.active) gfx.destroy();
    }
    result.canopyObjects.length = 0;

    // Gleise
    for (const ts of result.trackObjects) {
      if (ts.active) ts.destroy();
    }
    result.trackObjects.length = 0;

    // Dirt
    for (const img of result.dirtObjects) {
      if (img.active) img.destroy();
    }
    result.dirtObjects.length = 0;
  }

  // ── Private Factory-Methoden ───────────────────────────────────────────────

  /**
   * Erstellt einen Felsen-Sprite aus dem Autotile-Spritesheet.
   */
  private createRockVisual(worldX: number, worldY: number, frame: number): Phaser.GameObjects.Image {
    const img = this.scene.add.image(worldX, worldY, 'rocks', frame);
    img.setDisplaySize(CELL_SIZE, CELL_SIZE);
    img.setDepth(DEPTH.ROCKS);
    return img;
  }

  /**
   * Erstellt den Baumstumpf-Sprite (aktuell: Arc/Kreis).
   * Kann später durch `this.scene.add.image(...)` ersetzt werden.
   */
  private createTrunkVisual(worldX: number, worldY: number): Phaser.GameObjects.Arc {
    const circle = this.scene.add.circle(worldX, worldY, TRUNK_RADIUS, COLORS.BROWN_4);
    circle.setDepth(DEPTH.ROCKS);
    return circle;
  }

  /**
   * Erstellt die Baumkronen-Grafik als Image-Sprite (192×192 px = CANOPY_RADIUS * 2).
   */
  private createCanopyVisual(worldX: number, worldY: number): Phaser.GameObjects.Image {
    const img = this.scene.add.image(worldX, worldY, 'bg_canopy');
    img.setDisplaySize(CANOPY_RADIUS * 2, CANOPY_RADIUS * 2);
    img.setAngle(Phaser.Math.Between(0, 359));
    img.setDepth(DEPTH.CANOPY);
    return img;
  }

  /**
   * Erstellt einen Dirt-Sprite aus dem Autotile-Spritesheet.
   */
  private createDirtVisual(worldX: number, worldY: number, frame: number): Phaser.GameObjects.Image {
    const img = this.scene.add.image(worldX, worldY, 'dirt', frame);
    img.setDisplaySize(CELL_SIZE, CELL_SIZE);
    img.setDepth(DEPTH.DIRT);
    return img;
  }

  // ── Dirt ───────────────────────────────────────────────────────────────────

  /**
   * Baut Dirt-Sprites mit Autotiling (rein visuell, keine Physik/Kollision).
   */
  private buildDirt(dirtCells: DirtCell[]): Phaser.GameObjects.Image[] {
    if (dirtCells.length === 0) return [];

    const dirtGrid = new RockGridIndex(dirtCells);
    const isOccupied = (gx: number, gy: number) => dirtGrid.isOccupied(gx, gy);
    const result: Phaser.GameObjects.Image[] = [];

    for (const { gridX, gridY } of dirtCells) {
      const worldX = ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2;
      const mask   = AutoTiler.computeMask(gridX, gridY, isOccupied);
      const frame  = AutoTiler.getFrame(mask, DIRT_AUTOTILE);
      result.push(this.createDirtVisual(worldX, worldY, frame));
    }
    return result;
  }

  // ── Gleise ────────────────────────────────────────────────────────────────

  /**
   * Gruppiert TrackCells nach Spalte und erstellt pro Spalte einen TileSprite.
   * Gleise sind rein visuell (keine Physik-Gruppe), da sie begehbar sind.
   */
  private buildTracks(tracks: TrackCell[]): Phaser.GameObjects.TileSprite[] {
    // Spalten → maximale Zeilenzahl ermitteln
    const colRows = new Map<number, number>();
    for (const { gridX, gridY } of tracks) {
      const current = colRows.get(gridX) ?? 0;
      colRows.set(gridX, Math.max(current, gridY + 1));
    }
    const result: Phaser.GameObjects.TileSprite[] = [];
    for (const [col, rowCount] of colRows) {
      result.push(this.createTrackColumnVisual(col, rowCount));
    }
    return result;
  }

  /**
   * Erstellt einen TileSprite für eine vollständige Gleis-Spalte.
   * Die Textur 'bg_tracks' (64×32 px) passt exakt auf 2 Zellen Breite
   * und wird vertikal ohne Skalierung pro 32 px Zeile gekachelt.
   */
  private createTrackColumnVisual(col: number, rowCount: number): Phaser.GameObjects.TileSprite {
    const w = CELL_SIZE * 2;
    const h = rowCount * CELL_SIZE;
    const cx = ARENA_OFFSET_X + col * CELL_SIZE + w / 2;
    const cy = ARENA_OFFSET_Y + h / 2;

    const ts = this.scene.add.tileSprite(cx, cy, w, h, 'bg_tracks');
    ts.setDepth(DEPTH.TRACKS);
    return ts;
  }

  // ── Statische Interna ──────────────────────────────────────────────────────

  private drawSidebars(): void {
    this.scene.add
      .rectangle(ARENA_OFFSET_X / 2, GAME_HEIGHT / 2, ARENA_OFFSET_X, GAME_HEIGHT, COLORS.GREY_10)
      .setDepth(0);
    this.scene.add
      .rectangle(
        GAME_WIDTH - ARENA_OFFSET_X / 2,
        GAME_HEIGHT / 2,
        ARENA_OFFSET_X,
        GAME_HEIGHT,
        COLORS.GREY_9,
      )
      .setDepth(0);
  }

  private drawGrass(): void {
    this.scene.add
      .tileSprite(
        ARENA_OFFSET_X + ARENA_WIDTH / 2,
        ARENA_OFFSET_Y + ARENA_HEIGHT / 2,
        ARENA_WIDTH,
        ARENA_HEIGHT,
        'bg_grass',
      )
      .setDepth(DEPTH.GRASS);
  }

  private setPhysicsBounds(): void {
    this.scene.physics.world.setBounds(
      ARENA_OFFSET_X,
      ARENA_OFFSET_Y,
      ARENA_WIDTH,
      ARENA_HEIGHT,
    );
  }
}
