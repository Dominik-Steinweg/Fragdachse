import * as Phaser from 'phaser';
import { beginRockSweepDiagnostic, tracerBounceDebug } from './ProjectileBounceDiagnostics';
import type { RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';
import { OBSTACLE_ROCK, OBSTACLE_BASE, OBSTACLE_BARRIER, type ArenaObstacleIndex } from '../systems/ArenaObstacleIndex';
import { obstacleBlocks, segmentRectInterval, type ObstacleShotOptions } from '../systems/ObstacleRules';
import { CombatGeometry } from '../systems/CombatGeometry';
import { DEPTH } from '../config';
import { portalCircleEntry } from '../systems/PortalTraversal';
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
  readonly kind?: 'trunk' | 'barrier' | 'train' | 'world-boundary';
  readonly rockIndex: number;
  /** Base cells use the same sweep, but retain their base damage identity. */
  readonly baseId?: string;
  readonly x: number;
  readonly y: number;
  readonly normalX: number;
  readonly normalY: number;
  /** Center at first body contact, distinct from the surface point x/y. */
  readonly centerX?: number;
  readonly centerY?: number;
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
export type ProjectileMovementObserver = (id: number, x: number, y: number, vx: number, vy: number) => void;

export interface ProjectilePhysicsBindingPort {
  setWorldContactFilter?(filter: ((id: number, target: ProjectilePhysicsContactTarget, endX: number, endY: number) => boolean) | null): void;
  setContactFilter?(filter: ((id: number, endX: number, endY: number) => boolean) | null): void;
  findNearestPortalWorldSweep?(startX: number, startY: number, endX: number, endY: number,
    halfWidth: number, halfHeight: number, ignoreTrunks: boolean): ProjectileRockSweepHit | null;
  setMovementObserver?(observer: ProjectileMovementObserver | null): void;
  setRockGroup(
    group: Phaser.Physics.Arcade.StaticGroup | null,
    objects: (RockPhysicsProxy | null)[] | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void;
  setBaseGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void;
  setTrainGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void;
  setObstacleIndex(index: ArenaObstacleIndex | null): void;
  getSafeMuzzleGeometry(): ProjectileSafeMuzzleGeometry;
  getObstacleGeometry?(): CombatGeometry | null;
  findNearestRockSweep(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    ignoreRockIndex?: number,
    halfWidth?: number,
    halfHeight?: number,
    diagnosticProjectileId?: number,
    includeBases?: boolean,
    options?: ObstacleShotOptions,
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
  private worldContactFilter: ((id: number, target: ProjectilePhysicsContactTarget, endX: number, endY: number) => boolean) | null = null;
  setWorldContactFilter(filter: typeof this.worldContactFilter): void { this.worldContactFilter = filter; }
  private contactFilter: ((id: number, endX: number, endY: number) => boolean) | null = null;
  setContactFilter(filter: ((id: number, endX: number, endY: number) => boolean) | null): void { this.contactFilter = filter; }

  /** Technical geometry of surfaces which Arcade normally handles before the Scene update. */
  findNearestPortalWorldSweep(sx: number, sy: number, ex: number, ey: number,
    hw: number, hh: number, ignoreTrunks: boolean): ProjectileRockSweepHit | null {
    let best: ProjectileRockSweepHit | null = null;
    let nearest = Infinity;
    const dx = ex - sx, dy = ey - sy;
    const consider = (t: number, nx: number, ny: number, kind: NonNullable<ProjectileRockSweepHit['kind']>) => {
      if (t < 0 || t > 1 || t >= nearest || dx * nx + dy * ny >= 0) return;
      nearest = t;
      best = { rockIndex: -1, kind, x: sx + dx * t, y: sy + dy * t,
        centerX: sx + dx * t, centerY: sy + dy * t, normalX: nx, normalY: ny };
    };
    if (!ignoreTrunks) for (const child of this.trunkGroup?.getChildren() ?? []) {
      const tree = child as Phaser.GameObjects.Shape;
      const body = tree.body as Phaser.Physics.Arcade.StaticBody | null;
      if (!tree.active || !body?.enable) continue;
      const radius = Math.max(body.halfWidth, body.halfHeight) + Math.max(hw, hh);
      const cx = body.x + body.halfWidth, cy = body.y + body.halfHeight;
      const t = portalCircleEntry({ x: sx, y: sy }, { x: ex, y: ey }, { x: cx, y: cy }, radius);
      if (t !== null) { const x = sx + dx * t - cx, y = sy + dy * t - cy, len = Math.hypot(x, y) || 1;
        consider(t, x / len, y / len, 'trunk'); }
    }
    const train = this.getActiveTrainBounds();
    if (train && !ignoreTrunks) {
      const left = train.left - hw, right = train.right + hw, top = train.top - hh, bottom = train.bottom + hh;
      if (dx) for (const [x, nx] of [[left, -1], [right, 1]]) {
        const t = (x - sx) / dx, y = sy + t * dy;
        if (y >= top && y <= bottom) consider(t, nx, 0, 'train');
      }
      if (dy) for (const [y, ny] of [[top, -1], [bottom, 1]]) {
        const t = (y - sy) / dy, x = sx + t * dx;
        if (x >= left && x <= right) consider(t, 0, ny, 'train');
      }
    }
    const bounds = this.scene.physics.world.bounds;
    if (dx < 0) consider((bounds.left + hw - sx) / dx, 1, 0, 'world-boundary');
    if (dx > 0) consider((bounds.right - hw - sx) / dx, -1, 0, 'world-boundary');
    if (dy < 0) consider((bounds.top + hh - sy) / dy, 0, 1, 'world-boundary');
    if (dy > 0) consider((bounds.bottom - hh - sy) / dy, 0, -1, 'world-boundary');
    return best;
  }
  private movementObserver: ProjectileMovementObserver | null = null;
  private readonly observedHandles = new Map<number, ProjectilePhysicsHandle>();
  private readonly observeStep = (): void => {
    if (!this.movementObserver) return;
    for (const handle of this.observedHandles.values()) {
      const { body, sprite } = handle;
      if (!body.enable || !sprite.active) continue;
      // Arcade postUpdate applies precisely this displacement to the display anchor later.
      this.movementObserver(handle.id, sprite.x + body.x - body.prevFrame.x,
        sprite.y + body.y - body.prevFrame.y, body.velocity.x, body.velocity.y);
    }
  };

  setMovementObserver(observer: ProjectileMovementObserver | null): void {
    this.scene.physics.world.off('worldstep', this.observeStep);
    this.movementObserver = observer;
    if (observer) this.scene.physics.world.on('worldstep', this.observeStep);
  }
  private contactHandler: ProjectilePhysicsContactHandler | null = null;
  private rockGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private rockObjects: (RockPhysicsProxy | null)[] | null = null;
  private trunkGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private baseGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private trainGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private obstacleIndex: ArenaObstacleIndex | null = null;
  private obstacleGeometry: CombatGeometry | null = null;

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

  getObstacleGeometry(): CombatGeometry | null { return this.obstacleGeometry; }

  findNearestRockSweep(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    ignoreRockIndex?: number,
    halfWidth = 0,
    halfHeight = 0,
    diagnosticProjectileId?: number,
    includeBases = false,
    options: ObstacleShotOptions = {},
  ): ProjectileRockSweepHit | null {
    const diagnostic = tracerBounceDebug.centerline ? beginRockSweepDiagnostic({
      projectileId: diagnosticProjectileId, start: { x: startX, y: startY }, end: { x: endX, y: endY },
      halfWidth, halfHeight, indexed: this.obstacleIndex !== null,
    }) : undefined;
    const dx = endX - startX, dy = endY - startY, length = Math.hypot(dx, dy);
    if (length < 1e-9) return null;
    let carrierExit = this.obstacleGeometry?.carrierExitFraction(startX, startY, endX, endY,
      options.sourceCarrierBaseId, halfWidth, halfHeight) ?? -1;
    if (!this.obstacleGeometry && options.sourceCarrierBaseId) {
      const intervals = (this.baseGroup?.getChildren() ?? []).flatMap(child => {
        const cell = child as Phaser.GameObjects.Rectangle;
        if (!cell.active || cell.getData('baseId') !== options.sourceCarrierBaseId) return [];
        const b = cell.getBounds();
        const interval = segmentRectInterval(startX, startY, endX, endY, b.left - halfWidth,
          b.top - halfHeight, b.right + halfWidth, b.bottom + halfHeight);
        return interval ? [interval] : [];
      }).sort((a, b) => a.enter - b.enter);
      for (const interval of intervals) {
        if (carrierExit < 0 ? interval.enter > 0 : interval.enter > carrierExit + 1e-9) break;
        carrierExit = Math.max(carrierExit, interval.exit);
      }
    }
    const best = { index: -1, x: 0, y: 0, distance: Number.POSITIVE_INFINITY, normalX: 0, normalY: 0,
      left: 0, top: 0, right: 0, bottom: 0, baseId: undefined as string | undefined, barrier: false };
    const tangencies: { distance: number; normalX: number; normalY: number }[] = [];
    const mergeNormal = (normalX: number, normalY: number): void => {
      const commonX = best.normalX === normalX ? normalX : 0;
      const commonY = best.normalY === normalY ? normalY : 0;
      best.normalX = commonX || commonY ? commonX : Math.sign(best.normalX + normalX);
      best.normalY = commonX || commonY ? commonY : Math.sign(best.normalY + normalY);
    };
    const consider = (index: number, left: number, top: number, right: number, bottom: number, baseId?: string, barrier = false): void => {
      const candidate: NonNullable<typeof diagnostic>['candidates'][number] | undefined = diagnostic
        ? { index, left, top, right, bottom, baseId } : undefined;
      if (candidate && diagnostic!.candidates.length < 64) diagnostic!.candidates.push(candidate);
      if (index < 0 || (!barrier && baseId === undefined && index === ignoreRockIndex)) {
        if (candidate) candidate.rejected = 'ignored-rock';
        return;
      }
      const surfaceLeft = left, surfaceTop = top, surfaceRight = right, surfaceBottom = bottom;
      // Sweep the existing Arcade rectangle via Minkowski-expanded obstacle bounds.
      left -= halfWidth; right += halfWidth; top -= halfHeight; bottom += halfHeight;
      if ((!dx && (startX < left || startX > right)) || (!dy && (startY < top || startY > bottom))) {
        if (candidate) candidate.rejected = 'parallel-outside';
        return;
      }
      // Slab entry times identify the surface actually entered, not the nearest
      // edge of an overlap or a surface the projectile is already leaving.
      const nearX = dx ? ((dx > 0 ? left : right) - startX) / dx : -Infinity;
      const farX = dx ? ((dx > 0 ? right : left) - startX) / dx : Infinity;
      const nearY = dy ? ((dy > 0 ? top : bottom) - startY) / dy : -Infinity;
      const farY = dy ? ((dy > 0 ? bottom : top) - startY) / dy : Infinity;
      let enter = Math.max(nearX, nearY);
      const exit = Math.min(farX, farY);
      if (baseId === options.sourceCarrierBaseId && baseId !== undefined
        && carrierExit >= 0 && enter <= carrierExit + 1e-9) return;
      const startsInside = enter < 0 && exit >= 0 && options.purpose !== undefined && options.purpose !== 'physical';
      if (startsInside) enter = 0;
      if (candidate) { candidate.enter = enter; candidate.exit = exit; }
      if (enter < 0 || enter > 1 || exit < enter) {
        if (candidate) candidate.rejected = enter < 0 && exit >= 0 ? 'starts-inside' : 'no-entry';
        return;
      }
      const distance = enter * length;
      const entersInterior = exit > enter;
      if (distance > best.distance + 1e-7) return;
      const normalEntry = startsInside ? Math.max(nearX, nearY) : enter;
      const normalX = Math.abs(nearX - normalEntry) < 1e-9 ? -Math.sign(dx) : 0;
      const normalY = Math.abs(nearY - normalEntry) < 1e-9 ? -Math.sign(dy) : 0;
      if (!entersInterior) { tangencies.push({ distance, normalX, normalY }); return; }
      if (Math.abs(distance - best.distance) <= 1e-7) {
        // At a shared tile corner retain the common exterior face. An internal
        // seam must not add a second reflection; distinct concave faces still do.
        mergeNormal(normalX, normalY);
        if (index < best.index || (index === best.index && (baseId ?? '') < (best.baseId ?? ''))) {
          best.index = index;
          best.baseId = baseId;
          best.barrier = barrier;
          best.left = surfaceLeft; best.top = surfaceTop; best.right = surfaceRight; best.bottom = surfaceBottom;
        }
        return;
      }
      best.index = index;
      best.baseId = baseId;
      best.barrier = barrier;
      best.x = startX + dx * enter; best.y = startY + dy * enter; best.distance = distance;
      best.normalX = normalX; best.normalY = normalY;
      best.left = surfaceLeft; best.top = surfaceTop; best.right = surfaceRight; best.bottom = surfaceBottom;
    };
    if (this.obstacleIndex && this.obstacleGeometry) {
      this.obstacleIndex.querySegment(
        startX, startY, endX, endY,
        (kind, rockIndex, left, top, right, bottom, source) => {
          if (kind === OBSTACLE_ROCK && !options.ignoreRocks
            && obstacleBlocks(this.obstacleIndex!.getRockClass(rockIndex), options.purpose ?? 'physical')
            && !(this.obstacleIndex!.getRockClass(rockIndex) === 'low' && options.purpose === 'support'
              && options.acceptsLowTarget && !options.acceptsLowTarget(rockIndex))) consider(rockIndex, left, top, right, bottom);
          else if (kind === OBSTACLE_BARRIER) consider(0, left, top, right, bottom, undefined, true);
          else if (kind === OBSTACLE_BASE && includeBases) {
            const baseId = (source as { getData?: (key: string) => unknown }).getData?.('baseId');
            if (typeof baseId === 'string' && baseId) consider(0, left, top, right, bottom, baseId);
          }
          return false;
        },
        () => false,
        Math.max(halfWidth, halfHeight),
      );
    } else {
      for (let index = 0; index < (this.rockObjects?.length ?? 0); index += 1) {
        const rock = this.rockObjects![index];
        if (!rock?.active) continue;
        if (options.ignoreRocks || !obstacleBlocks(rock.obstacleClass ?? 'veryHigh', options.purpose ?? 'physical')) continue;
        if (rock.obstacleClass === 'low' && options.purpose === 'support'
          && options.acceptsLowTarget && !options.acceptsLowTarget(index)) continue;
        const bounds = rock.getBounds();
        consider(index, bounds.left, bounds.top, bounds.right, bounds.bottom);
      }
      if (includeBases) for (const child of this.baseGroup?.getChildren() ?? []) {
        const cell = child as Phaser.GameObjects.Rectangle;
        if (!cell.active) continue;
        const baseId = cell.getData('baseId') as string | undefined;
        if (!baseId) continue;
        const bounds = cell.getBounds();
        consider(0, bounds.left, bounds.top, bounds.right, bounds.bottom, baseId);
      }
    }
    if (best.index < 0) return null;
    // A tangent neighbour identifies an internal seam, but must neither receive
    // damage nor hide a later genuine entry when touched in isolation.
    for (const tangent of tangencies) if (Math.abs(tangent.distance - best.distance) <= 1e-7) {
      mergeNormal(tangent.normalX, tangent.normalY);
    }
    const hit: ProjectileRockSweepHit = { rockIndex: best.baseId === undefined && !best.barrier ? best.index : -1,
      baseId: best.baseId,
      kind: best.barrier ? 'barrier' : undefined,
      x: Math.max(best.left, Math.min(best.right, best.x)), y: Math.max(best.top, Math.min(best.bottom, best.y)),
      centerX: best.x, centerY: best.y, normalX: best.normalX, normalY: best.normalY };
    if (diagnostic) diagnostic.hit = { ...hit };
    return hit;
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
        flightPosition: { x: sprite.x + body.x - body.prevFrame.x, y: sprite.y + body.y - body.prevFrame.y },
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
        if (hitBody === body && this.contactFilter && !this.contactFilter(spec.id,
          sprite.x + body.prev.x - body.prevFrame.x + body.newVelocity.x,
          sprite.y + body.prev.y - body.prevFrame.y + body.newVelocity.y)) {
          // Restore the unbounded technical step; the owner will split it at the portal.
          body.position.set(body.prev.x + body.newVelocity.x, body.prev.y + body.newVelocity.y);
          const distance = body.newVelocity.length();
          if (distance > 0) body.setVelocity(body.newVelocity.x / distance * body.speed, body.newVelocity.y / distance * body.speed);
          return;
        }
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
            flightPosition: { x: sprite.x + body.x - body.prevFrame.x, y: sprite.y + body.y - body.prevFrame.y },
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
        (filter?.(targetObject as Phaser.GameObjects.GameObject) ?? true)
        && (this.worldContactFilter?.(spec.id, target(targetObject as Phaser.GameObjects.GameObject)!,
          sprite.x + body.x - body.prevFrame.x, sprite.y + body.y - body.prevFrame.y) ?? true)
        && (this.contactFilter?.(spec.id, sprite.x + body.x - body.prevFrame.x,
          sprite.y + body.y - body.prevFrame.y) ?? true)
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
    const handle = { id: spec.id, sprite, body, colliders, boundsListener };
    this.observedHandles.set(spec.id, handle);
    return handle;
  }

  releaseProjectileResources(handle: ProjectilePhysicsHandle): void {
    this.observedHandles.delete(handle.id);
    this.scene.physics.world.off('worldbounds', handle.boundsListener);
    for (const collider of handle.colliders) collider.destroy();
    handle.sprite.destroy();
  }

  releaseWorldState(): void {
    this.contactFilter = null;
    this.worldContactFilter = null;
    this.setMovementObserver(null);
    this.observedHandles.clear();
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
