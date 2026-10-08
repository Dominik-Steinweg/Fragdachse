import * as Phaser from 'phaser';
import { EnemyEyeBatch } from './EnemyEyeBatch';

/** Keep Image/tween semantics, but submit contiguous runs of stains as textured quads. */
export class BloodStainBatch {
  private readonly groups: { batch: EnemyEyeBatch; stains: Set<Phaser.GameObjects.Image> }[] = [];
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly texture: string, private readonly onDestroy: () => void) {
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  add(stain: Phaser.GameObjects.Image): void {
    // Enemies share this depth. Start a new run when another object was inserted
    // between stains, preserving Phaser's stable ordering at equal depth.
    let previous: Phaser.GameObjects.GameObject | undefined;
    const display = this.scene.children.list;
    for (let i = display.length - 1; i >= 0; i--) {
      const object = display[i];
      if (object !== stain && 'depth' in object && object.depth === stain.depth) { previous = object; break; }
    }
    let group = this.groups.find(candidate => candidate.batch.layer === previous);
    if (!group) {
      // This existing persistent quad writer is shared with lights as well as eyes.
      const batch = new EnemyEyeBatch(this.scene, this.texture, 32, stain.depth);
      batch.layer.setName('blood-stains');
      group = { batch, stains: new Set() };
      this.groups.push(group);
    }
    const stains = group.stains;
    stains.add(stain);
    stain.removeFromDisplayList();
    stain.once(Phaser.GameObjects.Events.DESTROY, () => stains.delete(stain));
  }

  private sync(): void {
    for (let index = 0; index < this.groups.length;) {
      const { batch, stains } = this.groups[index];
      if (!stains.size) { batch.destroy(); this.groups.splice(index, 1); continue; }
      index++;
      batch.begin(stains.size);
      // Insertion order preserves alpha compositing of overlapping stains.
      for (const stain of stains) {
        if (!stain.visible || stain.alpha <= 0) continue;
        // Phaser's Image submitter packs alpha into an 8-bit tint channel. Match
        // that quantization before handing the value to the GPU's float alpha.
        const alpha = ((stain.alpha * 255) | 0) / 255;
        batch.write(stain.x, stain.y, stain.displayWidth, stain.displayHeight,
          stain.rotation, stain.tintTopLeft, alpha);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const { batch, stains } of this.groups) {
      for (const stain of stains) { this.scene.tweens.killTweensOf(stain); stain.destroy(); }
      batch.destroy(); stains.clear();
    }
    this.groups.length = 0;
    this.onDestroy();
  }
}
