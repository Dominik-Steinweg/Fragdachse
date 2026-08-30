import * as Phaser from 'phaser';

/**
 * Eingefrorene, rein visuelle Entity-Projektion fuer den Arena-Exit-Fade.
 *
 * Sie besitzt weder Bodies noch Manager-/Gameplay-Referenzen. Dadurch koennen Player- und
 * Enemy-Runtimes sofort enden, waehrend das letzte sichtbare Bild bis zum Fade-Ende stehenbleibt.
 */
export class ArenaExitEntityPresentation {
  private readonly snapshots: Phaser.GameObjects.Image[] = [];
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    sources: readonly Phaser.GameObjects.Sprite[],
  ) {
    for (const source of sources) {
      if (!source.active || !source.visible || source.alpha <= 0) continue;
      const snapshot = scene.add.image(
        source.x,
        source.y,
        source.texture.key,
        source.frame.name,
      );
      snapshot
        .setOrigin(source.originX, source.originY)
        .setDisplaySize(source.displayWidth, source.displayHeight)
        .setRotation(source.rotation)
        .setAlpha(source.alpha)
        .setDepth(source.depth)
        .setFlip(source.flipX, source.flipY)
        .setScrollFactor(source.scrollFactorX, source.scrollFactorY)
        .setBlendMode(source.blendMode)
        .setTint(
          source.tintTopLeft,
          source.tintTopRight,
          source.tintBottomLeft,
          source.tintBottomRight,
        )
        .setTintMode(source.tintMode);
      this.snapshots.push(snapshot);
    }
  }

  get size(): number {
    return this.snapshots.length;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const snapshot of this.snapshots) snapshot.destroy();
    this.snapshots.length = 0;
  }
}
