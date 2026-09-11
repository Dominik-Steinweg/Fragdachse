import * as Phaser from 'phaser';
import { CELL_SIZE } from '../../config';
import type { ObstacleClass } from '../../systems/ObstacleRules';

/**
 * Nicht rendernder Arcade-Koerper eines Felsens. `Zone` besitzt Transform, Bounds und Active,
 * hat aber keinen Renderpfad; Gameplay und Physics referenzieren deshalb kein Visual mehr.
 */
export type RockPhysicsProxy = Phaser.GameObjects.GameObject & {
  obstacleClass?: ObstacleClass;
  readonly x: number;
  readonly y: number;
  body: Phaser.GameObjects.GameObject['body'];
  getBounds(output?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle;
};

export function createRockPhysicsProxy(
  scene: Phaser.Scene,
  x: number,
  y: number,
  obstacleClass: ObstacleClass = 'veryHigh',
): RockPhysicsProxy {
  const proxy = new Phaser.GameObjects.Zone(scene, x, y, CELL_SIZE, CELL_SIZE) as RockPhysicsProxy;
  proxy.obstacleClass = obstacleClass;
  return proxy;
}
