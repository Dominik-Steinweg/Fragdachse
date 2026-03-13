import Phaser from 'phaser';
import {
  GAME_WIDTH, GAME_HEIGHT,
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  DEPTH, COLORS, ROCKS, CANOPIES,
} from '../config';

export class ArenaBuilder {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Baut die komplette statische Arena und gibt die Felsen-Gruppe zurück. */
  build(): Phaser.Physics.Arcade.StaticGroup {
    this.drawSidebars();
    this.drawGrass();
    const rockGroup = this.createRocks();
    this.drawCanopies();
    this.setPhysicsBounds();
    return rockGroup;
  }

  private drawSidebars(): void {
    // Links
    this.scene.add
      .rectangle(ARENA_OFFSET_X / 2, GAME_HEIGHT / 2, ARENA_OFFSET_X, GAME_HEIGHT, COLORS.SIDEBAR)
      .setDepth(0);
    // Rechts
    this.scene.add
      .rectangle(
        GAME_WIDTH - ARENA_OFFSET_X / 2,
        GAME_HEIGHT / 2,
        ARENA_OFFSET_X,
        GAME_HEIGHT,
        COLORS.SIDEBAR,
      )
      .setDepth(0);
  }

  private drawGrass(): void {
    this.scene.add
      .rectangle(
        ARENA_OFFSET_X + ARENA_WIDTH / 2,
        ARENA_OFFSET_Y + ARENA_HEIGHT / 2,
        ARENA_WIDTH,
        ARENA_HEIGHT,
        COLORS.GRASS,
      )
      .setDepth(DEPTH.GRASS);
  }

  private createRocks(): Phaser.Physics.Arcade.StaticGroup {
    const group = this.scene.physics.add.staticGroup();

    for (const rock of ROCKS) {
      const worldX = ARENA_OFFSET_X + rock.x;
      const worldY = ARENA_OFFSET_Y + rock.y;
      const rect = this.scene.add.rectangle(worldX, worldY, rock.w, rock.h, COLORS.ROCK);
      rect.setDepth(DEPTH.ROCKS);
      group.add(rect);
      (rect.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    }

    return group;
  }

  private drawCanopies(): void {
    for (const canopy of CANOPIES) {
      const worldX = ARENA_OFFSET_X + canopy.x;
      const worldY = ARENA_OFFSET_Y + canopy.y;
      const gfx = this.scene.add.graphics();
      gfx.fillStyle(COLORS.CANOPY, COLORS.CANOPY_ALPHA);
      gfx.fillCircle(worldX, worldY, canopy.radius);
      gfx.setDepth(DEPTH.CANOPY);
    }
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
