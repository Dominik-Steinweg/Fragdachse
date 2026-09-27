import * as Phaser from 'phaser';
import { configureGpuLayerCameraTransform } from '../graphics/GpuLayerCameraTransform';

/** Persistent eye/light quads. Dense slots are overwritten, never emitted as particles. */
export class EnemyEyeBatch {
  readonly layer: Phaser.GameObjects.SpriteGPULayer;
  private readonly member: Float32Array;
  private readonly colors: Uint32Array;

  constructor(scene: Phaser.Scene, texture: string, capacity: number, depth?: number) {
    this.layer = new Phaser.GameObjects.SpriteGPULayer(scene, scene.textures.get(texture), capacity);
    // Let Phaser initialize its static frame/origin/animation defaults once. Only the
    // fixed values below change per eye; packing eight animation descriptors each time
    // is unnecessary. The Phaser 4.2.1 member layout is checked against its real packer.
    this.layer.addMember();
    this.member = this.layer.nextMemberF32.slice();
    this.colors = new Uint32Array(this.member.buffer);
    this.layer.memberCount = 0;
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
    member[0] = x; member[4] = y; member[8] = rotation;
    member[12] = width / this.layer.frame.realWidth;
    member[16] = height / this.layer.frame.realHeight; member[20] = alpha;
    const tint = Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(color, 1);
    this.colors[32] = this.colors[33] = this.colors[34] = this.colors[35] = tint;
    member[39] = this.layer.timeElapsed;
    this.layer.addData(member);
  }

  destroy(): void { this.layer.destroy(); }
}
