import { vi } from 'vitest';

import type {
  ProjectilePhysicsBindingPort,
  ProjectilePhysicsHandle,
  ProjectilePhysicsSpawnSpec,
  ProjectileMovementObserver,
} from '../src/projectile/ProjectilePhysicsBinding';
import type { ProjectilePhysicsContact } from '../src/projectile/ProjectileTargetPort';
import type { ProjectilePresentationRuntime } from '../src/projectile/ProjectilePresentationRuntime';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import { ProjectileReplicationAdapter } from '../src/projectile/ProjectileReplicationAdapter';
import { WorldProjectileRuntime } from '../src/projectile/WorldProjectileRuntime';

export interface TechnicalPhysicsBindingFixture {
  readonly binding: ProjectilePhysicsBindingPort;
  readonly handles: Map<number, ProjectilePhysicsHandle>;
  readonly specs: ProjectilePhysicsSpawnSpec[];
  readonly released: number[];
  readonly releaseWorldState: ReturnType<typeof vi.fn>;
  emit(contact: ProjectilePhysicsContact): boolean | undefined;
  observe(id: number, x: number, y: number, vx: number, vy: number): void;
}

/** Headless technical Physics boundary; gameplay ownership remains in WorldProjectileRuntime. */
export function createTechnicalPhysicsBinding(): TechnicalPhysicsBindingFixture {
  let contactHandler: ((contact: ProjectilePhysicsContact) => boolean) | null = null;
  let movementObserver: ProjectileMovementObserver | null = null;
  const handles = new Map<number, ProjectilePhysicsHandle>();
  const specs: ProjectilePhysicsSpawnSpec[] = [];
  const released: number[] = [];
  const releaseWorldState = vi.fn();

  const binding = {
    setMovementObserver: (observer: ProjectileMovementObserver | null) => { movementObserver = observer; },
    setRockGroup: vi.fn(),
    setBaseGroup: vi.fn(),
    setTrainGroup: vi.fn(),
    setObstacleIndex: vi.fn(),
    getSafeMuzzleGeometry: vi.fn(() => ({
      geometry: null,
      trainBounds: null,
      worldBounds: null,
    })),
    findNearestRockSweep: vi.fn(() => null),
    createPhysicsHandle: vi.fn((spec: ProjectilePhysicsSpawnSpec) => {
      const sprite = {
        active: true,
        x: spec.x,
        y: spec.y,
        displayWidth: spec.size,
        displayHeight: spec.size,
        setDisplaySize: vi.fn(),
        destroy: vi.fn(() => { sprite.active = false; }),
        getBounds: vi.fn(() => ({
          left: sprite.x - spec.size / 2,
          right: sprite.x + spec.size / 2,
          top: sprite.y - spec.size / 2,
          bottom: sprite.y + spec.size / 2,
        })),
      };
      const body = {
        enable: true,
        onWorldBounds: false,
        velocity: {
          x: spec.velocityX,
          y: spec.velocityY,
          length: () => Math.hypot(body.velocity.x, body.velocity.y),
        },
        x: spec.x,
        y: spec.y,
        width: spec.bodyWidth,
        prevFrame: { x: spec.x, y: spec.y },
        height: spec.bodyHeight,
        halfWidth: spec.bodyWidth / 2,
        halfHeight: spec.bodyHeight / 2,
        setVelocity: vi.fn((x: number, y: number) => {
          body.velocity.x = x;
          body.velocity.y = y;
        }),
        setDrag: vi.fn(),
        setSize: vi.fn(),
        setOffset: vi.fn(),
        setBounce: vi.fn(),
        setCollideWorldBounds: vi.fn(),
        reset: vi.fn((x: number, y: number) => {
          body.x = x;
          body.y = y;
          sprite.x = x;
          sprite.y = y;
          body.enable = true;
        }),
      };
      const handle = {
        id: spec.id,
        sprite,
        body,
        colliders: [],
        boundsListener: () => {},
      } as unknown as ProjectilePhysicsHandle;
      specs.push(spec);
      handles.set(spec.id, handle);
      return handle;
    }),
    releaseProjectileResources: vi.fn((handle: ProjectilePhysicsHandle) => {
      released.push(handle.id);
      (handle.sprite.destroy as unknown as () => void)();
    }),
    setPhysicsContactHandler: vi.fn((handler: ((contact: ProjectilePhysicsContact) => void) | null) => {
      contactHandler = handler as ((contact: ProjectilePhysicsContact) => boolean) | null;
    }),
    releaseWorldState,
  } satisfies ProjectilePhysicsBindingPort;

  return {
    binding,
    handles,
    specs,
    released,
    releaseWorldState,
    emit: (contact) => contactHandler?.(contact),
    observe: (id, x, y, vx, vy) => movementObserver?.(id, x, y, vx, vy),
  };
}

export function createPresentation(): ProjectilePresentationRuntime {
  return {
    registerFallbackShape: () => {},
    createSpawnRendererVisuals: () => {},
    createBfgVisual: () => {},
    createSpawnFeedback: () => {},
    playBounceImpact: () => {},
    destroyProjectileVisuals: () => {},
    clientVisualCount: 0,
    syncHostRenderers: vi.fn(),
    getShadowSamples: () => [],
    getLightSamples: () => [],
    presentClientFrame: vi.fn(),
    extrapolateClient: vi.fn(),
    releaseWorldPresentation: vi.fn(),
  } as unknown as ProjectilePresentationRuntime;
}

/** Builds a real world owner around the same technical binding used by contract tests. */
export function createProjectileRuntimeTestWorld(nowMs = 0) {
  const physics = createTechnicalPhysicsBinding();
  let hostNowMs = nowMs;
  const runtime = new WorldProjectileRuntime({
    physicsBinding: physics.binding,
    presentation: createPresentation(),
    identityScope: new ProjectileIdentityScope(1),
    hostNowMs: () => hostNowMs,
  });
  runtime.setProjectileReplicationAdapter(new ProjectileReplicationAdapter(runtime));
  return { runtime, physics, setHostNowMs: (nextNowMs: number) => { hostNowMs = nextNowMs; } };
}

export function projectilePhysicsContact(
  projectileId: number,
  target: ProjectilePhysicsContact['target'],
  x = 10,
  y = 10,
): ProjectilePhysicsContact {
  return { projectileId, target, x, y, velocityX: 100, velocityY: 0, source: 'physics-collider' };
}
