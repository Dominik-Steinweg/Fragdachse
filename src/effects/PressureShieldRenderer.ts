import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { configureAdditiveImage, fillRadialGradientTexture, registerGraphicsObject } from './EffectUtils';

const TEXTURE = '__rocket_pressure_shell';

/** A translucent moving pressure rim over the body, with no status icon. */
export class PressureShieldRenderer {
  private readonly shell: Phaser.GameObjects.Image;
  private readonly echo: Phaser.GameObjects.Image;

  constructor(private readonly scene: Phaser.Scene) {
    fillRadialGradientTexture(scene.textures, TEXTURE, 128, [
      [0, 'rgba(100,225,255,0)'], [0.5, 'rgba(100,225,255,0.02)'],
      [0.72, 'rgba(50,165,255,0.10)'], [0.85, 'rgba(100,235,255,0.65)'],
      [0.9, 'rgba(210,255,255,0.8)'], [1, 'rgba(60,160,255,0)'],
    ]);
    this.shell = configureAdditiveImage(scene.add.image(0, 0, TEXTURE), DEPTH.PLAYERS + 0.18, 0.5, 0xb2f5ff);
    this.echo = configureAdditiveImage(scene.add.image(0, 0, TEXTURE), DEPTH.PLAYERS + 0.19, 0.2, 0x65bfff);
    registerGraphicsObject(scene, 'playerStatus', this.shell);
    registerGraphicsObject(scene, 'playerStatus', this.echo);
  }

  sync(x: number, y: number, size: number, visible: boolean): void {
    const phase = this.scene.time.now * 0.006;
    const pulse = 1 + Math.sin(phase) * 0.035;
    this.shell.setPosition(x, y).setDisplaySize(size * 1.22 * pulse, size * 1.22 * pulse)
      .setAlpha(0.48 + Math.sin(phase) * 0.09).setVisible(visible);
    this.echo.setPosition(x, y).setDisplaySize(size * (1.32 + Math.sin(phase + 1) * 0.055), size * 1.32)
      .setAlpha(0.12 + Math.sin(phase + 1) * 0.05).setVisible(visible);
  }

  destroy(): void { this.shell.destroy(); this.echo.destroy(); }
}
