import { fakeEntity } from './fakeEntity';
import { describe, expect, it } from 'vitest';
import { WeaponUpgradeSystem } from '../src/systems/WeaponUpgradeSystem';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { FireSystem } from '../src/effects/FireSystem';
import type { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import { createSingleOwnerProvenance } from '../src/projectile/ProjectileSpawnRequest';
import type {
  ProjectileAwpCorridorCapability,
  ProjectileTravelSample,
} from '../src/projectile/ProjectileTravelPort';

interface DamageCall { targetId: string; amount: number; atMs: number }
interface RecoilCall { targetId: string; vx: number; vy: number; atMs: number }

/**
 * Projektil, das entlang der X-Achse fliegt; der Gegner steht seitlich versetzt
 * innerhalb der Schneisenbreite.
 */
function corridorSample(overrides: Partial<ProjectileAwpCorridorCapability> = {}): ProjectileTravelSample {
  return {
    projectileId: 1,
    fromX: 0,
    fromY: 0,
    toX: 200,
    toY: 0,
    provenance: createSingleOwnerProvenance('shooter', { weaponSourceId: 'AWP' }),
    capabilities: {
      canReceiveFireImbue: false,
      pathEffect: {
        kind: 'awp',
        awpCorridor: {
          halfWidth: 56,
          damage: 40,
          dotDurationMs: 500,
          dotTickIntervalMs: 100,
          knockback: 900,
          knockbackDurationMs: 260,
          ...overrides,
        },
      },
    },
  };
}

function buildSystem(samples: ProjectileTravelSample[]) {
  const damageCalls: DamageCall[] = [];
  const recoilCalls: RecoilCall[] = [];
  const enemies = new Map<string, { id: string; sprite: { x: number; y: number }; getCollisionRadius(): number }>([
    ['enemy-1', fakeEntity({ id: 'enemy-1', x: 100, y: 30, getCollisionRadius: () => 12 })],
  ]);
  let now = 0;

  const projectileTravel = { getTravelSamples: () => samples };
  const enemyManager = {
    getAllEnemies: () => [...enemies.values()],
    getEnemy: (id: string) => enemies.get(id),
    hasEnemy: (id: string) => enemies.has(id),
  } as unknown as EnemyManager;
  const combatSystem = {
    canDamageTarget: () => true,
    applyDamage: (targetId: string, amount: number) => { damageCalls.push({ targetId, amount, atMs: now }); },
  };
  const hostPhysics = {
    addRecoil: (targetId: string, vx: number, vy: number) => { recoilCalls.push({ targetId, vx, vy, atMs: now }); },
  } as unknown as HostPhysicsSystem;
  const fireSystem = { hostRefreshGroundCellsAlongSegment: () => {} } as unknown as FireSystem;

  const system = new WeaponUpgradeSystem(projectileTravel, enemyManager, combatSystem, hostPhysics, fireSystem);

  return {
    damageCalls,
    recoilCalls,
    enemies,
    advanceTo(nextMs: number) {
      now = nextMs;
      system.hostUpdate(nextMs);
    },
  };
}

describe('AWP-Schneise: Wegstoss vor kurzem Nachbrenner', () => {
  it('stoesst sofort weg und richtet erst danach ueber mehrere Ticks Schaden an', () => {
    const harness = buildSystem([corridorSample()]);

    harness.advanceTo(0);
    expect(harness.recoilCalls).toHaveLength(1);
    expect(harness.recoilCalls[0].targetId).toBe('enemy-1');
    // Wegstoss senkrecht zur Flugbahn (Projektil fliegt entlang +X).
    expect(harness.recoilCalls[0].vx).toBeCloseTo(0);
    expect(Math.abs(harness.recoilCalls[0].vy)).toBeCloseTo(900);
    // Kein Sofortschaden – der Gegner soll den Stoss ueberleben.
    expect(harness.damageCalls).toHaveLength(0);
  });

  it('verteilt den Gesamtschaden innerhalb einer halben Sekunde auf fuenf Ticks', () => {
    const harness = buildSystem([corridorSample()]);

    harness.advanceTo(0);
    for (let ms = 100; ms <= 600; ms += 100) harness.advanceTo(ms);

    expect(harness.damageCalls).toHaveLength(5);
    expect(harness.damageCalls.map(call => call.atMs)).toEqual([100, 200, 300, 400, 500]);
    const total = harness.damageCalls.reduce((sum, call) => sum + call.amount, 0);
    expect(total).toBeCloseTo(40);
  });

  it('bricht den Nachbrenner ab, sobald der Gegner nicht mehr existiert', () => {
    const harness = buildSystem([corridorSample()]);

    harness.advanceTo(0);
    harness.advanceTo(100);
    harness.enemies.delete('enemy-1');
    harness.advanceTo(600);

    expect(harness.damageCalls).toHaveLength(1);
  });

  it('bleibt untaetig, wenn die Schneise nicht aktiv ist (nicht voll aufgeladen)', () => {
    const harness = buildSystem([corridorSample({
      halfWidth: 0,
      damage: 0,
      knockback: undefined,
    })]);

    harness.advanceTo(0);
    harness.advanceTo(500);

    expect(harness.recoilCalls).toHaveLength(0);
    expect(harness.damageCalls).toHaveLength(0);
  });
});
