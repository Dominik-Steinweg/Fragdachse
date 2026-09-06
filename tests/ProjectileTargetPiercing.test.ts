import { describe, expect, it, vi } from 'vitest';

/**
 * Phaser-Ersatz mit echtem Rechteck-Schnitttest.
 *
 * Der Durchschlag hängt daran, dass dasselbe Projektil in einem Frame mehrere überlappende
 * Ziele erreicht. Eine Attrappe, die pauschal „trifft" meldet, würde die Debounce-Logik
 * nicht prüfen, sondern nur ihre Existenz.
 */
vi.mock('phaser', () => {
  class Rectangle {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }
  }

  // Der Konstruktor legt Scratch-Geometrie für andere Trefferpfade an; sie bleibt hier ungenutzt.
  class Line {
    x1 = 0; y1 = 0; x2 = 0; y2 = 0;
    setTo(x1: number, y1: number, x2: number, y2: number) {
      this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
      return this;
    }
  }
  class Circle {
    x = 0; y = 0; radius = 0;
  }

  return {
    Geom: {
      Rectangle,
      Line,
      Circle,
      Intersects: {
        RectangleToRectangle: (a: Rectangle, b: Rectangle) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
      },
    },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  };
});

import { createProjectileRuntimeTestWorld, projectilePhysicsContact } from './ProjectileRuntimeTestHelper';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';
import { createSingleOwnerProvenance } from '../src/projectile/ProjectileSpawnRequest';
import type { ProjectileInteractionSpec } from '../src/projectile/ProjectileSpawnRequest';
import type { ProjectileCollisionTargetQueryPort } from '../src/projectile/ProjectileTargetPort';

function request(overrides: {
  ownerId?: string;
  provenance?: ProjectileSpawnRequest['provenance'];
  flight?: Partial<ProjectileSpawnRequest['flight']>;
  interaction?: Partial<ProjectileInteractionSpec>;
  presentation?: Partial<ProjectileSpawnRequest['presentation']>;
} = {}): ProjectileSpawnRequest {
  const ownerId = overrides.ownerId ?? 'player-1';
  return {
    origin: { x: 0, y: 0, angle: 0 },
    flight: { speed: 100, size: 12, lifetimeMs: 1_000, maxBounces: 0, isGrenade: false, ...overrides.flight },
    provenance: overrides.provenance ?? createSingleOwnerProvenance(ownerId, { weaponSourceId: 'weapon.test' }),
    interaction: { directHit: { damage: 6 }, ...overrides.interaction },
    presentation: { color: 0xffffff, ownerColor: 0xffffff, style: 'tesla_bolt', ...overrides.presentation },
  };
}

function spawn(runtime: ReturnType<typeof createProjectileRuntimeTestWorld>['runtime'], value = request()): number {
  const id = runtime.spawnProjectile(value);
  if (id === null) throw new Error('Expected projectile spawn');
  return id;
}

describe('provider-independent collision order', () => {
  const permutations = [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 0, 4, 1, 3]];
  for (const collisionMode of ['sweep', 'overlap'] as const) {
    it.each([true, false])(`${collisionMode} preserves distance, key and epsilon-chain order (piercing=%s)`, piercesTargets => {
      for (const permutation of permutations) {
        const { runtime, physics } = createProjectileRuntimeTestWorld();
        const hits: string[] = [];
        const targets = [
          { id: 'a', x: 24 + 1.5e-6 },
          { id: 'b', x: 24 + 0.75e-6 },
          { id: 'c', x: 24 },
          { id: 'd', x: 24 },
          { id: 'z', x: 20 },
        ];
        let order = permutation;
        runtime.setProjectileCombatPort({
          resolveDirectImpact: ({ target }) => { hits.push(target.id); return { accepted: true }; },
          resolveExplosionCombat: () => ({ damagedTargetKeys: [] }),
        });
        runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
          for (const index of order) {
            const target = targets[index];
            sink('enemy', target.id, 'enemy', target.x, 0, 8, target.x - 8, -8, target.x + 8, 8);
          }
        } });
        const id = spawn(runtime, request({ flight: { collisionMode, piercesTargets } }));
        physics.handles.get(id)!.sprite.x = 30;
        runtime.runHostInteractionStage(0);
        // Characterizes the existing key-seeded epsilon ordering, including a non-transitive chain.
        expect(hits).toEqual(piercesTargets ? ['z', 'a', 'b', 'c', 'd'] : ['z']);
        expect(runtime.activeCount).toBe(piercesTargets ? 1 : 0);
        order = [...permutation].reverse();
        runtime.runHostInteractionStage(16);
        expect(hits).toEqual(piercesTargets ? ['z', 'a', 'b', 'c', 'd'] : ['z']);
        runtime.destroy();
      }
    });
  }

  it.each([[0, 1], [1, 0]])('keeps the nearer world blocker with provider order %j', (first, second) => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const hits: string[] = [];
    runtime.setProjectileCombatPort({
      resolveDirectImpact: ({ target }) => { hits.push(target.id); return { accepted: true }; },
      resolveExplosionCombat: () => ({ damagedTargetKeys: [] }),
    });
    runtime.setProjectileWorldBlockerPort({ getNearestBlockerDistance: () => 20 });
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
      for (const index of [first, second]) {
        const x = index === 0 ? 24 : 60;
        sink('enemy', String(index), 'enemy', x, 0, 8, x - 8, -8, x + 8, 8);
      }
    } });
    const id = spawn(runtime, request({ flight: { collisionMode: 'sweep', piercesTargets: true } }));
    physics.handles.get(id)!.sprite.x = 100;
    runtime.runHostInteractionStage(0);
    expect(hits).toEqual(['0']);
    expect(physics.handles.get(id)!.sprite.x).toBe(100);
    runtime.destroy();
  });

  it('deflects in the host stage with an empty general target view and replicates the same identity', () => {
    const { runtime } = createProjectileRuntimeTestWorld();
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: () => {} });
    const target = spawn(runtime);
    const blower = spawn(runtime, request({
      ownerId: 'blower-owner', interaction: { impulse: { deflectsProjectiles: true } },
    }));
    runtime.runHostInteractionStage(0);
    const threat = runtime.getThreatSamples().find(sample => sample.id === target)!;
    expect(threat.provenance.allegiance.ownerId).toBe('blower-owner');
    expect(runtime.activeCount).toBe(2);
    const replicas: Array<{ id: number; static: { ownerId: string } }> = [];
    runtime.readProjectileReplication(record => replicas.push(record));
    expect(replicas).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: target, static: expect.objectContaining({ ownerId: 'blower-owner' }) }),
      expect.objectContaining({ id: blower }),
    ]));
    runtime.destroy();
  });

  it.each(['rock', 'construction'] as const)('deduplicates world aliases with %s reported first across frames', first => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const hits: number[] = [];
    runtime.setRockHitCallback(id => hits.push(id));
    const id = spawn(runtime, request({ flight: { collisionMode: 'overlap', isBfg: true } }));
    let kinds: Array<'rock' | 'construction'> = first === 'rock'
      ? ['rock', 'construction'] : ['construction', 'rock'];
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
      for (const kind of kinds) sink(kind, 7, 'world', 0, 0, 12, -12, -12, 12, 12, 'rock');
    } });
    runtime.runHostInteractionStage(0);
    kinds.reverse();
    runtime.runHostInteractionStage(16);
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 7 }));
    expect(hits).toEqual([7]);
    expect(runtime.activeCount).toBe(1);
    runtime.destroy();
  });
});

describe('world contact dedupe ordering', () => {
  it.each(['bfg', 'gauss'] as const)('%s keeps pass-through when canonical and technical contact order changes', (style) => {
    for (const order of ['canonical-first', 'technical-first'] as const) {
      const { runtime, physics } = createProjectileRuntimeTestWorld();
      const hits: number[] = [];
      runtime.setRockHitCallback((id) => hits.push(id));
      const id = spawn(runtime, request(style === 'bfg'
        ? { flight: { collisionMode: 'overlap', isBfg: true }, presentation: { style: 'bfg' } }
        : {
          flight: { collisionMode: 'overlap', piercesTargets: true },
          interaction: { directHit: { damage: 6, gaussChain: { radius: 10, damageFactor: 1 } } },
          presentation: { style: 'gauss' },
        }));
      const readWorldRocks: ProjectileCollisionTargetQueryPort['readCollisionTargets'] = (sink) => {
        sink('rock', 7, 'world', 0, 0, 12, -12, -12, 12, 12, 'rock');
        sink('rock', 8, 'world', 0, 0, 12, -12, -12, 12, 12, 'rock');
      };

      if (order === 'canonical-first') {
        runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: readWorldRocks });
        runtime.runHostInteractionStage(0);
      } else {
        runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: () => {} });
        runtime.runHostInteractionStage(0);
        expect(physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 7 }))).toBe(false);
        runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: readWorldRocks });
        runtime.runHostInteractionStage(0);
      }

      expect(hits).toEqual([7, 8]);
      if (order === 'canonical-first') {
        expect(physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 7 }))).toBe(false);
        expect(hits).toEqual([7, 8]);
      }
    }
  });
});

describe('generic projectile target piercing', () => {
  it('resolves one world candidate and deduplicates a later technical contact', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const hits: number[] = [];
    runtime.setRockHitCallback((id) => hits.push(id));
    const id = spawn(runtime);
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: (sink) => sink('rock', 7, 'world', 0, 0, 12, -12, -12, 12, 12, 'rock') });
    runtime.runHostInteractionStage(0);
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 7 }));
    expect(hits).toEqual([7]);
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 7 }));
    expect(hits).toHaveLength(1);
  });

  it('damages every overlapping enemy once and keeps a piercing projectile alive', () => {
    const { runtime } = createProjectileRuntimeTestWorld();
    const hits: string[] = [];
    runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true });
    runtime.setProjectileCombatPort({ resolveDirectImpact: ({ target }) => { hits.push(target.id); return { accepted: true }; }, resolveExplosionCombat: () => ({ damagedTargetKeys: [] }) });
    const id = spawn(runtime, request({ flight: { collisionMode: 'overlap', piercesTargets: true } }));
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: (sink) => {
      sink('enemy', 'enemy-a', 'enemy-owner', -10, 0, 8, -18, -8, -2, 8);
      sink('enemy', 'enemy-b', 'enemy-owner', 10, 0, 8, 2, -8, 18, 8);
    } });
    runtime.runHostInteractionStage(0);
    expect(hits).toEqual(['enemy-a', 'enemy-b']);
    expect(runtime.activeCount).toBe(1);
  });

  it('never hits the same enemy twice across frames', () => {
    const { runtime } = createProjectileRuntimeTestWorld();
    const hits: string[] = [];
    runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true });
    runtime.setProjectileCombatPort({ resolveDirectImpact: ({ target }) => { hits.push(target.id); return { accepted: true }; }, resolveExplosionCombat: () => ({ damagedTargetKeys: [] }) });
    spawn(runtime, request({ flight: { collisionMode: 'overlap', piercesTargets: true } }));
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: (sink) => sink('enemy', 'enemy-a', 'enemy-owner', 0, 0, 8, -8, -8, 8, 8) });
    runtime.runHostInteractionStage(0);
    runtime.runHostInteractionStage(16);
    expect(hits).toEqual(['enemy-a']);
  });

  it('consumes an ordinary projectile on its first target', () => {
    const { runtime } = createProjectileRuntimeTestWorld();
    const hits: string[] = [];
    runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true });
    runtime.setProjectileCombatPort({ resolveDirectImpact: ({ target }) => { hits.push(target.id); return { accepted: true }; }, resolveExplosionCombat: () => ({ damagedTargetKeys: [] }) });
    spawn(runtime, request({ flight: { collisionMode: 'overlap' } }));
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: (sink) => {
      sink('enemy', 'enemy-a', 'enemy-owner', -10, 0, 8, -18, -8, -2, 8);
      sink('enemy', 'enemy-b', 'enemy-owner', 10, 0, 8, 2, -8, 18, 8);
    } });
    runtime.runHostInteractionStage(0);
    expect(hits).toEqual(['enemy-a']);
    expect(runtime.activeCount).toBe(0);
  });

  it('reflects through the barrier port with payload and provenance preserved', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const id = spawn(runtime, request({ interaction: { explosion: { radius: 20, maxDamage: 10, minDamage: 5, knockback: 0, selfDamageMult: 0, damageTarget: 'enemies' } } }));
    runtime.setProjectileBarrierPort({ resolveBarrier: ({ projectileId }) => projectileId === id ? ({
      kind: 'reflected', attributionId: 'shield-owner', ownerColor: 0x123456,
      allegiance: { ownerId: 'shield-owner' }, sourceId: 'environment.reflector_dome', sourceSlot: 'weapon1', angle: 0, keepGrenade: false,
    }) : ({ kind: 'passed' }) });
    runtime.runHostInteractionStage(0);
    const [reflectedThreat] = runtime.getThreatSamples();
    expect(runtime.getThreatSamples()).toHaveLength(1);
    expect(reflectedThreat?.provenance).toMatchObject({
      attributionId: 'shield-owner',
      allegiance: { ownerId: 'shield-owner' },
      gameplaySourceId: 'player-1', lineage: { reflected: true },
    });
    expect(reflectedThreat).toBeDefined();
    expect(reflectedThreat!.id).toBe(id);
    expect(reflectedThreat!.provenance.lineage?.parentProjectileId).toBeUndefined();
    expect(reflectedThreat!.provenance.weaponSourceId).toBe('weapon.test');
    expect(physics.specs).toHaveLength(1);
    expect(physics.released).toEqual([]);
    const replication: Array<{ id: number; static: { ownerId: string; color: number } }> = [];
    runtime.readProjectileReplication((record) => replication.push(record as typeof replication[number]));
    expect(replication).toMatchObject([{ id: reflectedThreat!.id, static: { ownerId: 'shield-owner' } }]);
    physics.emit(projectilePhysicsContact(reflectedThreat!.id, { kind: 'rock', id: 0 }));
    const explosion = runtime.runHostProjectileStage(0, 1).projectileExplosions[0];
    expect(explosion?.effect).toMatchObject({ radius: 20, maxDamage: 10 });
  });

  it('reflects a grenade with the remaining fuse and new owner', () => {
    const { runtime, setHostNowMs } = createProjectileRuntimeTestWorld();
    const payload = { type: 'spawn_enemy' as const, enemyKind: 'test-enemy', count: 1, offsetPx: 0 };
    const id = spawn(runtime, request({ flight: { isGrenade: true, fuseTimeMs: 1_000 }, interaction: { grenadeEffect: payload } }));
    runtime.setProjectileBarrierPort({ resolveBarrier: ({ projectileId }) => projectileId === id ? ({
      kind: 'reflected', attributionId: 'shield-owner', ownerColor: 0x123456,
      allegiance: { ownerId: 'shield-owner' }, sourceId: 'environment.reflector_dome', sourceSlot: 'weapon1', angle: 0, keepGrenade: true,
    }) : ({ kind: 'passed' }) });
    setHostNowMs(400);
    runtime.runHostInteractionStage(400);
    expect(runtime.activeCount).toBe(1);
    const beforeFuse = runtime.runHostProjectileStage(0, 999);
    expect(beforeFuse.grenadePayloads).toHaveLength(0);
    const atFuse = runtime.runHostProjectileStage(1, 1_000);
    expect(atFuse.grenadePayloads).toHaveLength(1);
    expect(atFuse.grenadePayloads[0]).toMatchObject({ effect: payload,
      provenance: { gameplaySourceId: 'player-1', attributionId: 'shield-owner', allegiance: { ownerId: 'shield-owner' } } });
    expect(runtime.activeCount).toBe(0);
  });

  it('deflects through the normal owner path with inherited effects', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const target = spawn(runtime, request({ interaction: { explosion: { radius: 20, maxDamage: 10, minDamage: 5, knockback: 0, selfDamageMult: 0, damageTarget: 'enemies' } } }));
    const blower = spawn(runtime, request({ ownerId: 'blower-owner', flight: { isFlame: true }, interaction: { impulse: { minKnockback: 100, maxKnockback: 100, deflectsProjectiles: true } } }));
    const targetSprite = physics.handles.get(target)!.sprite as unknown as { x: number; y: number };
    const blowerSprite = physics.handles.get(blower)!.sprite as unknown as { x: number; y: number };
    targetSprite.x = blowerSprite.x = 0;
    targetSprite.y = blowerSprite.y = 0;
    physics.handles.get(blower)!.body.setVelocity(0, 100);
    expect(runtime.deflectProjectile(target, blower, 0)).toBe(true);
    const reflected = runtime.getThreatSamples().find((sample) => sample.id !== blower);
    expect(reflected?.provenance).toMatchObject({
      attributionId: 'blower-owner',
      allegiance: { ownerId: 'blower-owner' },
      gameplaySourceId: 'player-1', lineage: { reflected: true },
    });
    expect(reflected).toBeDefined();
    expect(reflected!.id).toBe(target);
    expect(reflected!.provenance.lineage?.parentProjectileId).toBeUndefined();
    expect(reflected!.vx).toBeCloseTo(0);
    expect(reflected!.vy).toBeCloseTo(100);
    physics.emit(projectilePhysicsContact(reflected!.id, { kind: 'rock', id: 0 }));
    expect(runtime.runHostProjectileStage(0, 0).projectileExplosions[0]?.effect)
      .toMatchObject({ radius: 20, maxDamage: 10, minDamage: 5 });
  });

  it('keeps contact memory and lineage while redirecting cached homing to the new allegiance', () => {
    const { runtime } = createProjectileRuntimeTestWorld();
    const queryTargets = vi.fn();
    runtime.setProjectileTargetQueryPort({ queryTargets });
    runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true });
    const hits: number[] = [];
    runtime.setProjectileCombatPort({
      resolveDirectImpact: ({ projectileId }) => { hits.push(projectileId); return { accepted: true }; },
      resolveExplosionCombat: () => ({ damagedTargetKeys: [] }),
    });
    const id = spawn(runtime, request({
      provenance: {
        gameplaySourceId: 'original-source', attributionId: 'original-credit',
        allegiance: { ownerId: 'original-team' }, weaponSourceId: 'weapon.test',
        lineage: { parentProjectileId: 77 }, correlation: { ak47ShotId: 9 },
      },
      flight: {
        collisionMode: 'overlap', piercesTargets: true,
        homing: { acquireDelayMs: 0, searchRadius: 100, retargetIntervalMs: 100, maxTurnDegreesPerStep: 10 },
      },
    }));
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => sink('enemy', 'enemy-a', 'enemy', 0, 0, 8, -8, -8, 8, 8) });
    runtime.runHostInteractionStage(0);
    runtime.runHostProjectileStage(10, 10);
    expect(queryTargets.mock.calls.at(-1)?.[1]).toBe('original-team');
    const blower = spawn(runtime, request({
      provenance: { gameplaySourceId: 'blower-source', attributionId: 'blower-credit', allegiance: { ownerId: 'blower-team' } },
      interaction: { impulse: { deflectsProjectiles: true } },
    }));
    expect(runtime.deflectProjectile(id, blower, 10)).toBe(true);
    runtime.destroyProjectile(blower);
    runtime.runHostInteractionStage(11);
    runtime.runHostProjectileStage(1, 11);
    expect(hits).toEqual([id]);
    expect(queryTargets.mock.calls.at(-1)?.[1]).toBe('blower-team');
    expect(runtime.getThreatSamples()[0]?.provenance).toMatchObject({
      gameplaySourceId: 'original-source', attributionId: 'blower-credit',
      allegiance: { ownerId: 'blower-team' }, weaponSourceId: 'weapon.test',
      lineage: { parentProjectileId: 77, reflected: true }, correlation: { ak47ShotId: 9 },
    });
  });

  it('keeps plasma child creation on the semantic spawn path', () => {
    const { runtime } = createProjectileRuntimeTestWorld();
    const parent = spawn(runtime, request({ interaction: { directHit: { damage: 6 } } }));
    const hits: string[] = [];
    runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true });
    runtime.setProjectileCombatPort({ resolveDirectImpact: ({ target, projectileId }) => {
      hits.push(target.id);
      if (projectileId === parent) {
        spawn(runtime, request({
          flight: { collisionMode: 'overlap', piercesTargets: true },
          provenance: {
            ...createSingleOwnerProvenance('player-1', { weaponSourceId: 'weapon.plasma.swarm' }),
            lineage: { parentProjectileId: parent, plasmaSwarmChild: true, plasmaSwarmOriginEnemyId: 'enemy-a' },
          },
        }));
      }
      return { accepted: true };
    }, resolveExplosionCombat: () => ({ damagedTargetKeys: [] }) });
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: (sink) => {
      sink('enemy', 'enemy-a', 'enemy-owner', 0, 0, 8, -8, -8, 8, 8);
      sink('enemy', 'enemy-b', 'enemy-owner', 10, 0, 8, 2, -8, 18, 8);
    } });
    runtime.runHostInteractionStage(0);
    expect(hits).toEqual(['enemy-a', 'enemy-b']);
  });
});

describe('projectile sweep positions', () => {
  function configureSweepEnemy(
    runtime: ReturnType<typeof createProjectileRuntimeTestWorld>['runtime'],
    combat: ReturnType<typeof vi.fn>,
  ): void {
    runtime.setProjectileTargetabilityPort({
      canDamage: () => true,
      canDamageOwner: () => true,
      isTargetCurrentlyValid: () => true,
    });
    runtime.setProjectileCombatPort({
      resolveDirectImpact: combat,
      resolveExplosionCombat: () => ({ damagedTargetKeys: [] }),
    });
    runtime.setProjectileCollisionTargetQueryPort({
      readCollisionTargets: (sink) => sink(
        'enemy', 'enemy-a', 'enemy-owner', 40, 0, 8, 32, -8, 48, 8,
      ),
    });
  }

  it('keeps the frame endpoint when a sweep candidate is ignored', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const combat = vi.fn(() => ({ accepted: false }));
    const id = spawn(runtime, request({ flight: { collisionMode: 'sweep' } }));
    configureSweepEnemy(runtime, combat);
    const handle = physics.handles.get(id)!;
    handle.sprite.x = 100;

    runtime.runHostInteractionStage(0);

    expect(combat).toHaveBeenCalledOnce();
    expect(handle.sprite.x).toBe(100);
    expect(handle.sprite.y).toBe(0);
    expect(handle.body.velocity.x).toBe(100);
  });

  it('keeps the remaining frame movement after a non-terminal piercing hit', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const combat = vi.fn(() => ({ accepted: true }));
    const id = spawn(runtime, request({
      flight: { collisionMode: 'sweep', piercesTargets: true },
    }));
    configureSweepEnemy(runtime, combat);
    const handle = physics.handles.get(id)!;
    handle.sprite.x = 100;

    runtime.runHostInteractionStage(0);

    expect(combat).toHaveBeenCalledOnce();
    expect(runtime.activeCount).toBe(1);
    expect(handle.sprite.x).toBe(100);
    expect(handle.sprite.y).toBe(0);
  });

  it('leaves a terminal consumed sweep projectile at its confirmed impact point', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    let confirmedImpact: { x: number; y: number } | undefined;
    const combat = vi.fn(({ impact }: { impact: { x: number; y: number } }) => {
      confirmedImpact = impact;
      return { accepted: true };
    });
    const id = spawn(runtime, request({ flight: { collisionMode: 'sweep' } }));
    configureSweepEnemy(runtime, combat);
    const handle = physics.handles.get(id)!;
    handle.sprite.x = 100;

    runtime.runHostInteractionStage(0);

    expect(confirmedImpact).toBeDefined();
    expect(runtime.activeCount).toBe(0);
    expect(handle.sprite.x).toBeCloseTo(confirmedImpact!.x, 6);
    expect(handle.sprite.y).toBeCloseTo(confirmedImpact!.y, 6);
  });
});
