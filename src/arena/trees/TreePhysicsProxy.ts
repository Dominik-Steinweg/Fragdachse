import * as Phaser from 'phaser';
import { TRUNK_RADIUS } from '../../config';

/**
 * Nicht rendernder Arcade-Koerper eines Baumstamms.
 *
 * Nach demselben Muster wie die Fels-Proxies: `Zone` besitzt Transform, Bounds und Active, hat
 * aber keinen Renderpfad. Gameplay und Physics referenzieren damit kein Visual mehr - Stamm,
 * Krone und Schatten sind reine Darstellung, die auf dieser Runtime aufsetzt.
 *
 * `radius` macht den Koerper zugleich zu einem {@link ObstacleCircleBody}; die Hindernis- und
 * Lichtindices lesen ihre Geometrie deshalb aus derselben kanonischen Quelle.
 */
export type TreePhysicsProxy = Phaser.GameObjects.GameObject & {
  readonly x: number;
  readonly y: number;
  /** Kollisionsradius des Stamms; zugleich der Kreisradius im Hindernisindex. */
  readonly radius: number;
  body: Phaser.GameObjects.GameObject['body'];
  getBounds(output?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle;
};

/**
 * Erzeugt den Koerper eines Baumstamms.
 *
 * Die Zone traegt bewusst den vollen Stammdurchmesser: der statische Kreiskoerper wird daraus
 * abgeleitet, und ohne passende Ausdehnung saesse er versetzt.
 */
export function createTreePhysicsProxy(
  scene: Phaser.Scene,
  x: number,
  y: number,
): TreePhysicsProxy {
  const proxy = new Phaser.GameObjects.Zone(
    scene,
    x,
    y,
    TRUNK_RADIUS * 2,
    TRUNK_RADIUS * 2,
  ) as Phaser.GameObjects.Zone & { radius: number };
  proxy.radius = TRUNK_RADIUS;
  return proxy as TreePhysicsProxy;
}
