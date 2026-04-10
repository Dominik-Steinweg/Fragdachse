import * as Phaser from 'phaser';
import { DEPTH_FX } from '../config';

export class TranslocatorTeleportRenderer {
  constructor(private readonly scene: Phaser.Scene) {}

  playFlash(x: number, y: number, color: number, type: 'start' | 'end'): void {
    const isStart = type === 'start';

    // Vertikaler Strahl / Säule
    const columnHeight = isStart ? 128 : 160;
    const column = this.scene.add.rectangle(x, y - columnHeight / 2 + 16, 24, columnHeight, color, 0.8);
    column.setDepth(DEPTH_FX);
    column.setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: column,
      alpha: 0,
      scaleX: 0.1,
      duration: isStart ? 250 : 350,
      ease: 'Power2',
      onComplete: () => column.destroy(),
    });

    // Expandiender Ring an der Basis
    const ring = this.scene.add.circle(x, y, 16, color, 0.7);
    ring.setDepth(DEPTH_FX - 0.1);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    // Nur der Rand soll sichtbar sein, nicht gefüllt? 
    // circle(x,y,r,color,a) zeichnet gefüllt. Wir können isStroked auf true setzen
    ring.isStroked = true;
    ring.lineWidth = 4;
    ring.isFilled = false;
    ring.strokeColor = color;
    ring.strokeAlpha = 0.8;

    this.scene.tweens.add({
      targets: ring,
      scale: isStart ? 2.5 : 3.5,
      strokeAlpha: 0,
      alpha: 0, // Fallback falls isStroked = true nicht per Tween strokeAlpha direkt unterstützt
      duration: isStart ? 300 : 400,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    // Kern-Blitz (weiß)
    const core = this.scene.add.circle(x, y, 20, 0xffffff, 1.0);
    core.setDepth(DEPTH_FX + 0.1);
    core.setBlendMode(Phaser.BlendModes.ADD);
    
    this.scene.tweens.add({
      targets: core,
      alpha: 0,
      scale: isStart ? 2.5 : 3.0,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => core.destroy(),
    });
  }
}
