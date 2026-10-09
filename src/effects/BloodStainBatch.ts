import * as Phaser from 'phaser';
import { EnemyEyeBatch } from './EnemyEyeBatch';

interface StainGroup {
  batch: EnemyEyeBatch;
  stains: Set<Phaser.GameObjects.Image>;
}

/** Keep Image/tween semantics, but submit contiguous runs of stains as textured quads. */
export class BloodStainBatch {
  private readonly groups = new Map<Phaser.GameObjects.GameObject, StainGroup>();
  private readonly pending = new Map<Phaser.GameObjects.Image, { group?: StainGroup }>();
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly texture: string, private readonly onDestroy: () => void) {
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  add(stain: Phaser.GameObjects.Image): void {
    const entry: { group?: StainGroup } = {};
    this.pending.set(stain, entry);
    stain.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.pending.delete(stain);
      entry.group?.stains.delete(stain);
    });
  }

  private flushPending(): void {
    if (!this.pending.size) return;
    // Resolve whole arrival runs backwards, stopping when their predecessors are
    // known. Different depths cannot interleave; equal-depth enemies split runs.
    const runs = new Map<number, Phaser.GameObjects.Image[]>();
    const objects = [...this.scene.children.list];
    for (let i = objects.length - 1; i >= 0; i--) {
      const object = objects[i];
      if (!('depth' in object)) continue;
      const depth = object.depth as number;
      const stain = object as Phaser.GameObjects.Image;
      if (this.pending.has(stain)) {
        let run = runs.get(depth);
        if (!run) runs.set(depth, run = []);
        run.push(stain);
        continue;
      }
      const run = runs.get(depth);
      if (!run) continue;
      this.flushPendingRun(depth, run, this.groups.get(object));
      runs.delete(depth);
      if (!this.pending.size) return;
    }
    for (const [depth, run] of runs) this.flushPendingRun(depth, run);
  }

  private flushPendingRun(depth: number, run: Phaser.GameObjects.Image[], group?: StainGroup): void {
    if (!group) {
      const batch = new EnemyEyeBatch(this.scene, this.texture, 32, depth);
      batch.layer.setName('blood-stains');
      // Replace the first arrival at its original position, before the stable
      // depth sort, so later equal-depth enemies remain above this run.
      this.scene.children.moveBelow(batch.layer, run[run.length - 1]);
      group = { batch, stains: new Set() };
      this.groups.set(batch.layer, group);
    }
    // The scan collected newest first; append in original compositing order.
    for (let i = run.length - 1; i >= 0; i--) {
      const stain = run[i];
      const entry = this.pending.get(stain)!;
      entry.group = group;
      group.stains.add(stain);
      this.pending.delete(stain);
      stain.removeFromDisplayList();
    }
  }

  private sync(): void {
    this.flushPending();
    for (const [layer, { batch, stains }] of this.groups) {
      if (!stains.size) { batch.destroy(); this.groups.delete(layer); continue; }
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
    for (const stain of this.pending.keys()) { this.scene.tweens.killTweensOf(stain); stain.destroy(); }
    this.pending.clear();
    for (const { batch, stains } of this.groups.values()) {
      for (const stain of stains) { this.scene.tweens.killTweensOf(stain); stain.destroy(); }
      batch.destroy(); stains.clear();
    }
    this.groups.clear();
    this.onDestroy();
  }
}
