import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { ArenaLayout } from '../types';
import { AutoTiler, ROCK_AUTOTILE } from '../arena/AutoTiler';
import { ROCK_BLOB_SURFACE_PROFILE } from '../arena/BlobSurfaceProfile';
import { resolveBlobSurfaceCornerTints } from '../arena/BlobSurfaceShading';
import type { LobbyObstacleWorld } from './LobbyObstacleWorld';

/** Rand um die Sequenzzone, in dem Felsen ebenfalls einen Kollisionskörper bekommen. */
const ZONE_MARGIN_PX = CELL_SIZE * 6;

export interface LobbyZoneRect {
  left:   number;
  top:    number;
  right:  number;
  bottom: number;
}

/**
 * Kollisionskörper der Lobby-Felsen – nur dort, wo gerade gespielt wird.
 *
 * Der geteilte {@link ProjectileManager} löst Fels-Treffer über eine Arcade-StaticGroup auf.
 * Die Lobby hält ihre Felsen aber gebacken, nicht als Live-Images; hunderte unsichtbare
 * Körper dauerhaft vorzuhalten wäre genau das, was die Vorschau vermeiden soll.
 *
 * Deshalb entstehen die Körper pro Sequenz und nur für die Zone, in der sie stattfindet
 * (plus Rand). Ausserhalb davon gibt es keine Ambient-Projektile, und Sichtlinie sowie
 * Hitscan laufen ohnehin über den leichten Hindernis-Index des {@link LobbyObstacleWorld},
 * der die gesamte Karte abdeckt.
 *
 * Das Array ist bewusst nach *echtem* Fels-Index besetzt und sonst `null`: Die
 * Kollisions-Rückrufe des Projektilmanagers schlagen darüber vom getroffenen Objekt auf den
 * Fels-Index zurück.
 */
export class LobbyRockBodyPool {
  private group: Phaser.Physics.Arcade.StaticGroup | null = null;
  private objects: (Phaser.GameObjects.Image | null)[] = [];
  private trunkGroup: Phaser.Physics.Arcade.StaticGroup | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layout: ArenaLayout,
    private readonly world: LobbyObstacleWorld,
  ) {}

  getGroup(): Phaser.Physics.Arcade.StaticGroup | null {
    return this.group;
  }

  getObjects(): (Phaser.GameObjects.Image | null)[] | null {
    return this.group ? this.objects : null;
  }

  getTrunkGroup(): Phaser.Physics.Arcade.StaticGroup | null {
    return this.trunkGroup;
  }

  /** Wie viele Körper gerade existieren – Grundlage der Teardown-Invariante. */
  get activeBodyCount(): number {
    return this.objects.reduce((count, entry) => count + (entry ? 1 : 0), 0);
  }

  /**
   * Legt Körper für alle lebenden Felsen in der Zone an. Ein erneuter Aufruf ersetzt den
   * bisherigen Bestand vollständig.
   */
  acquireForZone(zone: LobbyZoneRect): void {
    this.release();

    const group = this.scene.physics.add.staticGroup();
    this.objects = new Array(this.layout.rocks.length).fill(null);

    const left = zone.left - ZONE_MARGIN_PX;
    const top = zone.top - ZONE_MARGIN_PX;
    const right = zone.right + ZONE_MARGIN_PX;
    const bottom = zone.bottom + ZONE_MARGIN_PX;

    for (let id = 0; id < this.layout.rocks.length; id += 1) {
      if (!this.world.isRockAlive(id)) continue;
      const { gridX, gridY } = this.layout.rocks[id];
      const world = this.world.cellToWorld(gridX, gridY);
      if (world.x < left || world.x > right || world.y < top || world.y > bottom) continue;

      // Unsichtbar: Das sichtbare Bild kommt aus dem gebackenen Fels-Band der Vorschau.
      // Hier zählt allein der Kollisionskörper.
      const body = this.createBodyImage(world.x, world.y, gridX, gridY);
      group.add(body);
      (body.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      this.objects[id] = body;
    }

    group.refresh();
    this.group = group;
    this.trunkGroup = this.scene.physics.add.staticGroup();
  }

  /**
   * Entfernt den Körper eines zerstörten Felsens. Der Rest der Zone bleibt bestehen – eine
   * Explosion nimmt sonst mitten im Gefecht allen anderen Felsen ihre Kollision.
   */
  removeBody(rockId: number): void {
    const body = this.objects[rockId];
    if (!body) return;
    this.group?.remove(body, true, true);
    this.objects[rockId] = null;
    this.group?.refresh();
  }

  /** Baut einen Körper nach dem Neubau eines Felsens wieder auf. */
  restoreBody(rockId: number): void {
    if (!this.group || this.objects[rockId]) return;
    const cell = this.layout.rocks[rockId];
    if (!cell) return;
    const world = this.world.cellToWorld(cell.gridX, cell.gridY);
    const body = this.createBodyImage(world.x, world.y, cell.gridX, cell.gridY);
    this.group.add(body);
    (body.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    this.objects[rockId] = body;
    this.group.refresh();
  }

  /**
   * Unsichtbarer Kollisionskörper einer Felszelle.
   *
   * Er trägt trotzdem den richtigen AutoTile-Frame und die Eckentints des gebackenen Bildes:
   * Bei der Zerstörung dient genau dieses Objekt dem {@link RockDestructionRenderer} als
   * Vorlage für die Trümmer. Mit einem Ersatzframe zerbräche der Fels sichtbar in der
   * falschen Form.
   */
  private createBodyImage(
    worldX: number,
    worldY: number,
    gridX: number,
    gridY: number,
  ): Phaser.GameObjects.Image {
    const isOccupied = (cellX: number, cellY: number) => this.world.isRockCellWithBorder(cellX, cellY);
    const frame = AutoTiler.getFrame(AutoTiler.computeMask(gridX, gridY, isOccupied), ROCK_AUTOTILE);
    const body = this.scene.add.image(worldX, worldY, 'rocks', frame);
    body.setDisplaySize(CELL_SIZE, CELL_SIZE);
    body.setTint(...resolveBlobSurfaceCornerTints(ROCK_BLOB_SURFACE_PROFILE, gridX, gridY, isOccupied));
    // Das sichtbare Bild kommt aus dem gebackenen Fels-Band der Vorschau.
    body.setVisible(false);
    return body;
  }

  /** Gibt alle Körper frei. Nach dem Aufruf existiert garantiert keiner mehr. */
  release(): void {
    for (const body of this.objects) body?.destroy();
    this.objects = [];
    this.group?.destroy(true);
    this.group = null;
    this.trunkGroup?.destroy(true);
    this.trunkGroup = null;
  }
}
