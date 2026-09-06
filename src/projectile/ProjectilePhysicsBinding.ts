import * as Phaser from 'phaser';
import type { RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';
import { OBSTACLE_ROCK, type ArenaObstacleIndex } from '../systems/ArenaObstacleIndex';
import { CombatGeometry } from '../systems/CombatGeometry';
import { findNearestRectangleHit } from '../utils/geometry';
import { DEPTH } from '../config';
import type { ProjectilePhysicsContact, ProjectilePhysicsContactTarget } from './ProjectileTargetPort';
import type { ProjectileId } from './ProjectileSpawnPort';

/** Technical body/collider instructions prepared by the world-owned runtime. */
export interface ProjectilePhysicsMechanics {
  readonly bodyResponse: 'none' | 'bounce';
  readonly rockContactMode: 'collider' | 'overlap';
  readonly trunkContactMode: 'collider' | 'overlap';
  readonly baseContactMode: 'collider' | 'overlap';
  readonly trainContactMode: 'collider' | 'overlap';
  readonly stopOnRockContact: boolean;
  readonly stopOnTrunkContact: boolean;
  readonly stopOnBaseContact: boolean;
  readonly stopOnTrainContact: boolean;
  readonly stopOnWorldBoundary: boolean;
  readonly worldBounds: boolean;
  readonly rock: boolean;
  readonly trunk: boolean;
  readonly base: boolean;
  readonly train: boolean;
  readonly ignoreRockIndex?: number;
}

export interface ProjectilePhysicsSpawnSpec {
  readonly id: ProjectileId;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: number;
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly bodyOffsetX: number;
  readonly bodyOffsetY: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly mechanics: ProjectilePhysicsMechanics;
}

/** Technical geometry view used by the runtime's semantic spawn resolver. */
export interface ProjectileSafeMuzzleGeometry {
  readonly geometry: CombatGeometry | null;
  readonly trainBounds: Phaser.Geom.Rectangle | null;
  readonly worldBounds: Phaser.Geom.Rectangle | null;
}

export interface ProjectileRockSweepHit {
  readonly rockIndex: number;
  readonly x: number;
  readonly y: number;
  readonly normalX: number;
  readonly normalY: number;
}

/** Phaser-owned resources. This type must not cross a public gameplay boundary. */
export interface ProjectilePhysicsHandle {
  readonly id: ProjectileId;
  readonly sprite: Phaser.GameObjects.Shape;
  readonly body: Phaser.Physics.Arcade.Body;
  readonly colliders: Phaser.Physics.Arcade.Collider[];
  readonly boundsListener: (body: Phaser.Physics.Arcade.Body) => void;
}

export type ProjectilePhysicsContactHandler = (contact: ProjectilePhysicsContact) => void;

export interface ProjectilePhysicsBindingPort {
  setRockGroup(
    group: Phaser.Physics.Arcade.StaticGroup | null,
    objects: (RockPhysicsProxy | null)[] | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void;
  setBaseGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void;
  setTrainGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void;
  setObstacleIndex(index: ArenaObstacleIndex | null): void;
  getSafeMuzzleGeometry(): ProjectileSafeMuzzleGeometry;
  findNearestRockSweep(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    ignoreRockIndex?: number,
  ): ProjectileRockSweepHit | null;
  createPhysicsHandle(spec: ProjectilePhysicsSpawnSpec): ProjectilePhysicsHandle;
  releaseProjectileResources(handle: ProjectilePhysicsHandle): void;
  setPhysicsContactHandler(handler: ProjectilePhysicsContactHandler | null): void;
  releaseWorldState(): void;
}

/**
 * World-local Phaser binding. It owns only Phaser objects, groups, colliders and geometry lookup.
 * Contact meaning and lifecycle decisions return to WorldProjectileRuntime as primitive contacts.
 */
export class ProjectilePhysicsBinding implements ProjectilePhysicsBindingPort {
  private contactHandler: ProjectilePhysicsContactHandler | null = null;
  private rockGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private rockObjects: (RockPhysicsProxy | null)[] | null = null;
  private trunkGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private baseGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private trainGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private obstacleIndex: ArenaObstacleIndex | null = null;
  private obstacleGeometry: CombatGeometry | null = null;
  private readonly sweepLine = new Phaser.Geom.Line();
  private readonly sweepRect = new Phaser.Geom.Rectangle();
  private readonly sweepPoints: Phaser.Math.Vector2[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  setPhysicsContactHandler(handler: ProjectilePhysicsContactHandler | null): void {
    this.contactHandler = handler;
  }

  setRockGroup(
    group: Phaser.Physics.Arcade.StaticGroup | null,
    objects: (RockPhysicsProxy | null)[] | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    this.rockGroup = group;
    this.rockObjects = objects;
    this.trunkGroup = trunkGroup;
  }

  setBaseGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void { this.baseGroup = group; }
  setTrainGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void { this.trainGroup = group; }
  setObstacleIndex(index: ArenaObstacleIndex | null): void {
    this.obstacleIndex = index;
    this.obstacleGeometry = index ? new CombatGeometry(index) : null;
  }

  getSafeMuzzleGeometry(): ProjectileSafeMuzzleGeometry {
    return {
      geometry: this.obstacleGeometry,
      trainBounds: this.getActiveTrainBounds(),
      worldBounds: this.scene.physics.world.bounds,
    };
  }

  findNearestRockSweep(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    ignoreRockIndex?: number,
  ): ProjectileRockSweepHit | null {
    const line = this.sweepLine.setTo(startX, startY, endX, endY);
    const best = { index: -1, x: 0, y: 0, distance: Number.POSITIVE_INFINITY, left: 0, top: 0, right: 0, bottom: 0 };
    const consider = (index: number, left: number, top: number, right: number, bottom: number): void => {
      if (index < 0 || index === ignoreRockIndex) return;
      const hit = this.obstacleGeometry
        ? this.obstacleGeometry.nearestRectangleHit(line, this.obstacleGeometry.obstacleRect(left, top, right, bottom))
        : findNearestRectangleHit(line, this.sweepRect.setTo(left, top, right - left, bottom - top), this.sweepPoints);
      if (!hit || hit.distance >= best.distance) return;
      best.index = index;
      best.x = hit.x; best.y = hit.y; best.distance = hit.distance;
      best.left = left; best.top = top; best.right = right; best.bottom = bottom;
    };
    if (this.obstacleIndex && this.obstacleGeometry) {
      this.obstacleIndex.querySegment(
        startX, startY, endX, endY,
        (kind, rockIndex, left, top, right, bottom) => {
          if (kind === OBSTACLE_ROCK) consider(rockIndex, left, top, right, bottom);
          return false;
        },
        () => false,
      );
    } else if (this.rockObjects) {
      for (let index = 0; index < this.rockObjects.length; index += 1) {
        const rock = this.rockObjects[index];
        if (!rock?.active) continue;
        const bounds = rock.getBounds();
        consider(index, bounds.left, bounds.top, bounds.right, bounds.bottom);
      }
    }
    if (best.index < 0) return null;
    const distances = [
      { axis: 'left', value: Math.abs(best.x - best.left) },
      { axis: 'right', value: Math.abs(best.x - best.right) },
      { axis: 'top', value: Math.abs(best.y - best.top) },
      { axis: 'bottom', value: Math.abs(best.y - best.bottom) },
    ] as const;
    const minDistance = Math.min(...distances.map((entry) => entry.value));
    let normalX = 0; let normalY = 0;
    for (const edge of distances) {
      if (edge.value > minDistance + 0.75) continue;
      if (edge.axis === 'left') normalX -= 1;
      if (edge.axis === 'right') normalX += 1;
      if (edge.axis === 'top') normalY -= 1;
      if (edge.axis === 'bottom') normalY += 1;
    }
    if (normalX === 0 && normalY === 0) {
      normalX = Math.sign(best.x - (best.left + best.right) * 0.5);
      normalY = Math.sign(best.y - (best.top + best.bottom) * 0.5);
    }
    return { rockIndex: best.index, x: best.x, y: best.y, normalX, normalY };
  }

  private getActiveTrainBounds(): Phaser.Geom.Rectangle | null {
    if (!this.trainGroup) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const child of this.trainGroup.getChildren()) {
      const segment = child as Phaser.GameObjects.Rectangle;
      if (!segment.active) continue;
      const body = segment.body as Phaser.Physics.Arcade.StaticBody | null;
      if (body && !body.enable) continue;
      const halfWidth = segment.displayWidth * 0.5;
      const halfHeight = segment.displayHeight * 0.5;
      minX = Math.min(minX, segment.x - halfWidth); maxX = Math.max(maxX, segment.x + halfWidth);
      minY = Math.min(minY, segment.y - halfHeight); maxY = Math.max(maxY, segment.y + halfHeight);
    }
    return Number.isFinite(minX)
      ? new Phaser.Geom.Rectangle(minX, minY, maxX - minX, maxY - minY)
      : null;
  }

  createPhysicsHandle(spec: ProjectilePhysicsSpawnSpec): ProjectilePhysicsHandle {
    const sprite = this.scene.add.rectangle(spec.x, spec.y, spec.size, spec.size, spec.color);
    sprite.setDepth(DEPTH.PROJECTILES);
    this.scene.physics.add.existing(sprite);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(spec.bodyWidth, spec.bodyHeight);
    body.setOffset(spec.bodyOffsetX, spec.bodyOffsetY);
    body.setVelocity(spec.velocityX, spec.velocityY);

    const colliders: Phaser.Physics.Arcade.Collider[] = [];
    let boundsListener: (hitBody: Phaser.Physics.Arcade.Body) => void = () => {};
    const report = (
      target: ProjectilePhysicsContactTarget,
      source: ProjectilePhysicsContact['source'] = 'physics-collider',
    ): void => {
      this.contactHandler?.({
        projectileId: spec.id,
        target,
        x: body.x + body.halfWidth,
        y: body.y + body.halfHeight,
        velocityX: body.velocity.x,
        velocityY: body.velocity.y,
        source,
      });
    };

    if (spec.mechanics.worldBounds) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      if (spec.mechanics.bodyResponse === 'bounce') body.setBounce(1, 1);
      boundsListener = (hitBody) => {
        if (hitBody === body && spec.mechanics.stopOnWorldBoundary) body.setVelocity(0, 0);
        if (hitBody === body) report({ kind: 'world-boundary' }, 'world-boundary');
      };
      this.scene.physics.world.on('worldbounds', boundsListener);
    }

    const rockIndex = (object: Phaser.GameObjects.GameObject): number => (
      this.rockObjects?.indexOf(object as RockPhysicsProxy) ?? -1
    );
    const register = (
      group: Phaser.Physics.Arcade.StaticGroup | null,
      target: (gameObject?: Phaser.GameObjects.GameObject) => ProjectilePhysicsContactTarget | null,
      enabled: boolean,
      contactMode: 'collider' | 'overlap',
      stopOnContact: boolean,
      filter?: (gameObject: Phaser.GameObjects.GameObject) => boolean,
    ): void => {
      if (!group || !enabled) return;
      const callback = (_projectile: unknown, targetObject: unknown): void => {
        const targetGameObject = targetObject as Phaser.GameObjects.GameObject;
        const resolved = target(targetGameObject);
        if (resolved) {
          const bounds = (targetGameObject as Phaser.GameObjects.GameObject & {
            getBounds?: () => Phaser.Geom.Rectangle;
          }).getBounds?.();
          this.contactHandler?.({
            projectileId: spec.id,
            target: resolved,
            x: body.x + body.halfWidth,
            y: body.y + body.halfHeight,
            targetBounds: bounds
              ? { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }
              : undefined,
            velocityX: body.velocity.x,
            velocityY: body.velocity.y,
            source: 'physics-collider',
          });
          if (stopOnContact) body.setVelocity(0, 0);
        }
      };
      const process = (_projectile: unknown, targetObject: unknown): boolean => (
        filter?.(targetObject as Phaser.GameObjects.GameObject) ?? true
      );
      const collider = contactMode === 'overlap'
        ? this.scene.physics.add.overlap(sprite, group, callback, process)
        : this.scene.physics.add.collider(sprite, group, callback, process);
      colliders.push(collider);
    };

    register(this.rockGroup, (object) => {
      const id = object === undefined ? -1 : rockIndex(object);
      return id >= 0 ? { kind: 'rock', id } : null;
    }, spec.mechanics.rock, spec.mechanics.rockContactMode, spec.mechanics.stopOnRockContact,
    (object) => rockIndex(object) !== spec.mechanics.ignoreRockIndex);
    register(this.trunkGroup, () => ({ kind: 'trunk' }), spec.mechanics.trunk,
      spec.mechanics.trunkContactMode, spec.mechanics.stopOnTrunkContact);
    register(this.baseGroup, (object) => {
      const baseId = object?.getData('baseId') as string | undefined;
      return baseId ? { kind: 'base', id: baseId } : null;
    }, spec.mechanics.base, spec.mechanics.baseContactMode, spec.mechanics.stopOnBaseContact);
    register(this.trainGroup, () => ({ kind: 'train', id: 'main' }), spec.mechanics.train,
      spec.mechanics.trainContactMode, spec.mechanics.stopOnTrainContact);
    return { id: spec.id, sprite, body, colliders, boundsListener };
  }

  releaseProjectileResources(handle: ProjectilePhysicsHandle): void {
    this.scene.physics.world.off('worldbounds', handle.boundsListener);
    for (const collider of handle.colliders) collider.destroy();
    handle.sprite.destroy();
  }

  releaseWorldState(): void {
    this.contactHandler = null;
    this.rockGroup = null;
    this.rockObjects = null;
    this.trunkGroup = null;
    this.baseGroup = null;
    this.trainGroup = null;
    this.obstacleIndex = null;
    this.obstacleGeometry = null;
  }
}
