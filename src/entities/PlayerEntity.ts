import Phaser from 'phaser';
import type { PlayerProfile } from '../types';
import {
  PLAYER_SIZE, DEPTH,
  HP_MAX, HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_OFFSET_Y,
} from '../config';

export class PlayerEntity {
  readonly id:     string;
  readonly sprite: Phaser.GameObjects.Rectangle;

  private hpBarBg:  Phaser.GameObjects.Rectangle;
  private hpBarFg:  Phaser.GameObjects.Rectangle;
  private currentHp = HP_MAX;

  constructor(scene: Phaser.Scene, profile: PlayerProfile, x: number, y: number) {
    this.id = profile.id;

    // Spieler-Sprite
    this.sprite = scene.add.rectangle(x, y, PLAYER_SIZE, PLAYER_SIZE, profile.colorHex);
    this.sprite.setDepth(DEPTH.PLAYERS);
    scene.physics.add.existing(this.sprite);
    this.body.setCollideWorldBounds(true);

    // HP-Balken Hintergrund (dunkelgrau, zentriert)
    this.hpBarBg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x333333);
    this.hpBarBg.setDepth(DEPTH.PLAYERS + 1);

    // HP-Balken Vordergrund (farbig, links ausgerichtet)
    this.hpBarFg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x00cc44);
    this.hpBarFg.setOrigin(0, 0.5);   // linke Kante als Ankerpunkt → schrumpft von rechts
    this.hpBarFg.setDepth(DEPTH.PLAYERS + 2);

    this.syncBar();
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.sprite.body as Phaser.Physics.Arcade.Body;
  }

  /** Sprite + Physik-Body + HP-Balken positionieren. */
  setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.body.reset(x, y);
    this.syncBar();
  }

  /**
   * HP-Balken an aktuelle Sprite-Position angleichen.
   * Jeden Frame aufrufen wenn Sprite durch Physik bewegt wurde.
   */
  syncBar(): void {
    const x = this.sprite.x;
    const y = this.sprite.y + HP_BAR_OFFSET_Y;
    this.hpBarBg.setPosition(x, y);
    this.hpBarFg.setPosition(x - HP_BAR_WIDTH / 2, y);
  }

  /** HP-Wert aktualisieren und Balken neu zeichnen. */
  updateHP(hp: number): void {
    this.currentHp = Math.max(0, Math.min(HP_MAX, hp));
    const ratio    = this.currentHp / HP_MAX;
    this.hpBarFg.width = HP_BAR_WIDTH * ratio;
    const color    = ratio > 0.5 ? 0x00cc44 : ratio > 0.25 ? 0xffcc00 : 0xff3300;
    this.hpBarFg.setFillStyle(color);
  }

  /** Sprite und Balken ein-/ausblenden (Tod / Respawn). */
  setVisible(visible: boolean): void {
    this.sprite.setVisible(visible);
    this.hpBarBg.setVisible(visible);
    this.hpBarFg.setVisible(visible);
  }

  destroy(): void {
    this.hpBarBg.destroy();
    this.hpBarFg.destroy();
    this.sprite.destroy();
  }
}
