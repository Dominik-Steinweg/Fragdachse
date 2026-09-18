import * as Phaser from 'phaser';
import { createRockPhysicsProxy, type RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';
import type { WorldMetrics } from '../world/WorldMetrics';
import { SHOOTING_RANGE_CONTROLS, shootingRangeControlPosition } from './ShootingRangeLayout';

/** World-owned low obstacles. Rendering, damageable rocks and Activity barriers remain separate. */
export class ShootingRangeControlBodies {
  readonly bodies: readonly RockPhysicsProxy[];
  private enabled: boolean | null = null;

  constructor(scene: Phaser.Scene, metrics: WorldMetrics, group: Phaser.Physics.Arcade.StaticGroup,
    private readonly onChanged: () => void) {
    this.bodies = SHOOTING_RANGE_CONTROLS.map(control => {
      const point = shootingRangeControlPosition(metrics, control);
      const body = createRockPhysicsProxy(scene, point.x, point.y, 'low');
      group.add(body);
      (body.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      return body;
    });
    this.sync(false);
  }

  sync(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.bodies.forEach((proxy, index) => {
      const active = enabled || SHOOTING_RANGE_CONTROLS[index] === 'power';
      proxy.setActive(active);
      (proxy.body as Phaser.Physics.Arcade.StaticBody).enable = active;
    });
    this.onChanged();
  }

  destroy(): void { this.bodies.forEach(body => body.destroy()); }
}
