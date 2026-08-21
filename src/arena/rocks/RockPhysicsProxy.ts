import * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';

/**
 * Nicht rendernder Arcade-Koerper eines Felsens. `Zone` besitzt Transform, Bounds und Active,
 * hat aber keinen Renderpfad; Gameplay und Physics referenzieren deshalb kein Visual mehr.
 */
export type RockPhysicsProxy = Phaser.GameObjects.GameObject & {
  readonly x: number;
  readonly y: number;
  body: Phaser.GameObjects.GameObject['body'];
  getBounds(output?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle;
};

export function createRockPhysicsProxy(
  scene: Phaser.Scene,
  x: number,
  y: number,
): RockPhysicsProxy {
  return new Phaser.GameObjects.Zone(scene, x, y, CELL_SIZE, CELL_SIZE) as RockPhysicsProxy;
}
