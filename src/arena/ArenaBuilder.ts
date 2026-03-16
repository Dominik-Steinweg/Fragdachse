import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  DEPTH, COLORS,
  CELL_SIZE, TRUNK_RADIUS, CANOPY_RADIUS, CANOPY_ALPHA_PLAYER, ROCK_HP_THRESHOLD,
} from '../config';
import type { ArenaLayout, TrackCell } from '../types';

export interface ArenaBuilderResult {
  /** StaticGroup mit Felsen-Rechtecken (für Kollision + HP-Tracking) */
  rockGroup:    Phaser.Physics.Arcade.StaticGroup;
  /** Paralleles Array zu layout.rocks – null-Slots = bereits zerstört */
  rockObjects:  (Phaser.GameObjects.Rectangle | null)[];
  /** StaticGroup mit Baumstümpfen (Kreis-Körper, keine HP) */
  trunkGroup:   Phaser.Physics.Arcade.StaticGroup;
  /** Baumstumpf-Objekte für Hitscan-/Melee-Sweeps */
  trunkObjects: Phaser.GameObjects.Arc[];
  /** Baumkronen-Sprites für Transparenz-Update */
  canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }>;
  /** Gleis-TileSprites (eine pro Gleis-Spalte, nur visuell, keine Kollision) */
  trackObjects: Phaser.GameObjects.TileSprite[];
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
    const rockObjects:  (Phaser.GameObjects.Rectangle | null)[] = [];
    const trunkObjects: Phaser.GameObjects.Arc[] = [];
    const canopyObjects: Array<{ gfx: Phaser.GameObjects.Image; worldX: number; worldY: number }> = [];

    // Gleise (vor Felsen zeichnen, damit depth-Reihenfolge stimmt)
    const trackObjects = this.buildTracks(layout.tracks ?? []);

    // Felsen
    for (let i = 0; i < layout.rocks.length; i++) {
      const { gridX, gridY } = layout.rocks[i];
      const worldX = ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2;
      const rect   = this.createRockVisual(worldX, worldY);
      rockGroup.add(rect);
      (rect.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      rockObjects.push(rect);
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

    return { rockGroup, rockObjects, trunkGroup, trunkObjects, canopyObjects, trackObjects };
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
   * Aktualisiert Farbe eines Felsens anhand seines HP-Wertes.
   * Bei hp <= 0 wird der Fels zerstört.
   */
  static updateRockVisual(
    rockObjects: (Phaser.GameObjects.Rectangle | null)[],
    rockGroup:   Phaser.Physics.Arcade.StaticGroup,
    id:          number,
    hp:          number,
  ): void {
    if (hp <= 0) {
      ArenaBuilder.destroyRock(rockObjects, rockGroup, id);
      return;
    }
    const rect = rockObjects[id];
    if (!rect?.active) return;

    const color = hp < ROCK_HP_THRESHOLD ? COLORS.BROWN_3 : COLORS.BROWN_5;
    rect.setFillStyle(color);
  }

  /**
   * Entfernt einen Fels physikalisch und visuell aus der Szene.
   * Sicher mehrfach aufzurufen (idempotent via null-Slot).
   */
  static destroyRock(
    rockObjects: (Phaser.GameObjects.Rectangle | null)[],
    rockGroup:   Phaser.Physics.Arcade.StaticGroup,
    id:          number,
  ): void {
    const rect = rockObjects[id];
    if (!rect) return;
    rockGroup.remove(rect, true, true);
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
    for (const rect of result.rockObjects) {
      if (rect?.active) rect.destroy();
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
  }

  // ── Private Factory-Methoden (Swap-Vorbereitung für Sprites) ──────────────

  /**
   * Erstellt den Felsen-Sprite (aktuell: Rectangle).
   * Kann später durch `this.scene.add.image(...)` ersetzt werden.
   */
  private createRockVisual(worldX: number, worldY: number): Phaser.GameObjects.Rectangle {
    const rect = this.scene.add.rectangle(worldX, worldY, CELL_SIZE, CELL_SIZE, COLORS.BROWN_5);
    rect.setDepth(DEPTH.ROCKS);
    return rect;
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
    img.setDepth(DEPTH.CANOPY);
    return img;
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
   * Die Textur 'bg_tracks' (48×48 px) wird vertikal gekachelt.
   */
  private createTrackColumnVisual(col: number, rowCount: number): Phaser.GameObjects.TileSprite {
    const w = CELL_SIZE;
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
