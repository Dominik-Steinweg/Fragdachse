import { describe, expect, it, vi } from 'vitest';
import { getCoopDefenseEnemyConfig } from '../../src/config/coopDefenseEnemies';
import { CoopDefenseEnergyConeSystem, type EnergyConeTarget } from '../../src/systems/CoopDefenseEnergyConeSystem';
import { EMPTY_ENERGY_CONE_STATE, ENERGY_CONE_CLIP_RAYS, type EnergyConeState } from '../../src/systems/EnergyConeState';
import type { EnemyEntity } from '../../src/entities/EnemyEntity';

vi.mock('phaser', () => ({}));

const config = getCoopDefenseEnemyConfig('alien-badger').energyCone!;
const FRAME_MS = 1000 / 60;
const DURATION_MS = 30_000;
const TARGET_PX = (config.triggerMinDistancePx + config.triggerMaxDistancePx) / 2;

function alien(index: number) {
  let cone: EnergyConeState = EMPTY_ENERGY_CONE_STATE;
  const sprite = { active: true, x: 0, y: index * 500 };
  const enemy = {
    id: `a${index}`, kind: 'alien-badger', faction: 'hostile', sprite,
    getHp: () => 180, isBurrowed: () => false, getSpecialAction: () => 'none', getDashPhase: () => 0,
    faceAngle() {}, stopMovement() {},
    getEnergyConeState: () => cone,
    applyEnergyConeState: (state: EnergyConeState) => { if (state.revision > cone.revision) cone = state; },
  } as unknown as EnemyEntity;
  return { enemy, cone: () => cone };
}

function run(count: number, players: number, coverChanges: boolean) {
  const aliens = Array.from({ length: count }, (_, i) => alien(i));
  const counts = { readTarget: 0, rays: 0, impulseTargets: 0, impulses: 0, starts: 0, publishes: 0 };
  const hitsPerAttack = new Map<string, number>();
  let tick = 0;
  const system = new CoopDefenseEnergyConeSystem({
    enemies: { getAllEnemies: () => aliens.map(a => a.enemy) },
    combat: { hasClearLineOfFire: () => true, isStunned: () => false },
    readTarget: enemy => { counts.readTarget++; return { x: TARGET_PX, y: enemy.sprite.y }; },
    impulseTargets: enemy => {
      counts.impulseTargets++;
      // The struck players stand inside the fan; 100 bystanders behind the caster never qualify.
      const targets: EnergyConeTarget[] = Array.from({ length: players }, (_, p) => ({ id: `p${p}`, x: TARGET_PX, y: enemy.sprite.y + p * 8, radius: 16 }));
      for (let b = 0; b < 100; b++) targets.push({ id: `b${b}`, x: -200 - b * 10, y: enemy.sprite.y, radius: 12 });
      return targets;
    },
    // A cover profile that flickers every tick when requested, to bound republishing work.
    measureRay: (_x, _y, _angle, length) => { counts.rays++; return coverChanges && tick % 2 ? length * 0.5 : length; },
    impulse: (targetId, casterId) => {
      counts.impulses++;
      const attack = aliens.find(a => a.enemy.id === casterId)!.cone().attack!;
      const key = `${casterId}:${attack.startedAt}:${targetId}`;
      hitsPerAttack.set(key, (hitsPerAttack.get(key) ?? 0) + 1);
      return true;
    },
  });
  const previous = new Map<string, number>();
  for (let now = 0; now <= DURATION_MS; now += FRAME_MS, tick++) {
    system.hostUpdate(now);
    for (const a of aliens) {
      const state = a.cone();
      if (state.revision !== (previous.get(a.enemy.id) ?? 0)) counts.publishes++;
      if (state.phase === 'windup' && state.attack?.startedAt === now) counts.starts++;
      previous.set(a.enemy.id, state.revision);
    }
  }
  system.clear();
  return { counts, hitsPerAttack, aliens, system };
}

describe('energy cone stress (counted work, not wall time)', () => {
  for (const count of [1, 4, 16, 64]) for (const players of [1, 4]) for (const coverChanges of [false, true]) {
    it(`${count} aliens, ${players} player(s), ${coverChanges ? 'flickering' : 'static'} cover: bounded work, one hit per target and attack`, () => {
      const { counts, hitsPerAttack, aliens, system } = run(count, players, coverChanges);
      const ticks = Math.floor(DURATION_MS / FRAME_MS) + 1;
      const maxStarts = count * (Math.floor(DURATION_MS / (config.windupMs + config.cooldownMs)) + 1);
      expect(counts.starts).toBeGreaterThanOrEqual(count);
      expect(counts.starts).toBeLessThanOrEqual(maxStarts);
      // Targets are read only while idle; impulse targets once per impulse; rays per start + refresh only.
      expect(counts.readTarget).toBeLessThanOrEqual(count * ticks);
      expect(counts.impulseTargets).toBeLessThanOrEqual(counts.starts);
      const refreshesPerWindup = Math.ceil(config.windupMs / config.coverRefreshMs) + 1;
      expect(counts.rays).toBeLessThanOrEqual(counts.starts * ENERGY_CONE_CLIP_RAYS * refreshesPerWindup);
      // Republishing is bounded by the refresh interval, never per frame.
      expect(counts.publishes).toBeLessThanOrEqual(counts.starts * (refreshesPerWindup + 3));
      expect([...hitsPerAttack.values()].every(hits => hits === 1)).toBe(true);
      expect(counts.impulses).toBeLessThanOrEqual(counts.starts * players);
      // Teardown leaves no cone, blocker or movement override behind.
      for (const a of aliens) {
        expect(a.cone()).toMatchObject({ phase: 'none', attack: null });
        expect(system.blocksRegularAttacks(a.enemy.id)).toBe(false);
        expect(system.getMovementOverride(a.enemy)).toBeNull();
      }
    });
  }
});
