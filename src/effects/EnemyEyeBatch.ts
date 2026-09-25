import * as Phaser from 'phaser';
import { configureGpuLayerCameraTransform } from '../graphics/GpuLayerCameraTransform';

/** Persistent eye/light quads. Dense slots are overwritten, never emitted as particles. */
export class EnemyEyeBatch {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private readonly member = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1,
    tintTopLeft: 0xffffff, tintTopRight: 0xffffff, tintBottomLeft: 0xffffff, tintBottomRight: 0xffffff };

  constructor(scene: Phaser.Scene, texture: string, capacity: number, depth?: number) {
    this.layer = new Phaser.GameObjects.SpriteGPULayer(scene, scene.textures.get(texture), capacity);
    configureGpuLayerCameraTransform(this.layer);
    if (depth !== undefined) { this.layer.setDepth(depth); scene.add.existing(this.layer); }
    this.layer.setVisible(false);
  }

  begin(count: number): void {
    if (count > this.layer.size) this.layer.resize(2 ** Math.ceil(Math.log2(count)));
    this.layer.memberCount = 0;
    this.layer.setVisible(count > 0);
  }

  write(x: number, y: number, width: number, height: number, rotation: number, color: number, alpha: number): void {
    const member = this.member;
    member.x = x; member.y = y; member.scaleX = width / this.layer.frame.realWidth;
    member.scaleY = height / this.layer.frame.realHeight; member.rotation = rotation;
    member.tintTopLeft = member.tintTopRight = member.tintBottomLeft = member.tintBottomRight = color;
    member.alpha = alpha;
    this.layer.addMember(member);
  }

  destroy(): void { this.layer.destroy(); }
}
