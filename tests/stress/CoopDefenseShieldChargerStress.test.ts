import { describe, expect, it } from 'vitest';
import { getCoopDefenseEnemyConfig } from '../../src/config/coopDefenseEnemies';
import { CoopDefenseShieldChargerSystem, type ShieldChargeContactTarget } from '../../src/systems/CoopDefenseShieldChargerSystem';
import { EMPTY_SHIELD_CHARGE_STATE, type ShieldChargeState } from '../../src/systems/ShieldChargeState';
import type { EnemyEntity } from '../../src/entities/EnemyEntity';

const config = getCoopDefenseEnemyConfig('shield-charger-badger').shieldCharger!;
const FRAME_MS = 1000 / 60;
const DURATION_MS = 30_000;

function charger(index: number) {
  let charge: ShieldChargeState = EMPTY_SHIELD_CHARGE_STATE;
  const sprite = { active: true, x: 0, y: index * 400 };
  const enemy = {
    id: `sc${index}`, kind: 'shield-charger-badger', faction: 'hostile', sprite,
    getHp: () => 120, isBurrowed: () => false, isAttackMovementPaused: () => false,
    getAimAngle: () => 0, getCollisionRadius: () => 15, stopMovement() {}, faceAngle() {}, setKnockbackImmune() {},
    getShieldChargeState: () => charge,
    applyShieldChargeState: (state: ShieldChargeState) => { if (state.revision > charge.revision) charge = state; },
  } as unknown as EnemyEntity;
  return { enemy, sprite, charge: () => charge };
}

function run(count: number, players: number) {
  const chargers = Array.from({ length: count }, (_, i) => charger(i));
  const counts = { readTarget: 0, laneClearance: 0, contactTargets: 0, strikes: 0, starts: 0 };
  const struckPerCharge = new Map<string, number>();
  const system = new CoopDefenseShieldChargerSystem({
    enemies: { getAllEnemies: () => chargers.map(c => c.enemy) },
    combat: { hasClearLineOfFire: () => true, isStunned: () => false },
    readTarget: enemy => { counts.readTarget++; return { x: 300, y: enemy.sprite.y }; },
    contactTargets: enemy => {
      counts.contactTargets++;
      // The struck players walk back into the lane after each charge; 100 bystanders stay clear.
      const targets: ShieldChargeContactTarget[] = Array.from({ length: players }, (_, p) => ({ id: `p${p}`, x: 300 + p * 6, y: enemy.sprite.y, radius: 16 }));
      for (let b = 0; b < 100; b++) targets.push({ id: `b${b}`, x: b * 40, y: enemy.sprite.y + 200, radius: 12 });
      return targets;
    },
    laneClearance: (_x, _y, _a, length) => { counts.laneClearance++; return length; },
    strike: (targetId, chargerId) => {
      counts.strikes++;
      const charge = chargers.find(c => c.enemy.id === chargerId)!.charge();
      const key = `${chargerId}:${charge.revision}:${targetId}`;
      struckPerCharge.set(key, (struckPerCharge.get(key) ?? 0) + 1);
      return true;
    },
    knockback: () => {},
  });
  let previousPhase = new Map<string, string>();
  for (let now = 0; now <= DURATION_MS; now += FRAME_MS) {
    system.hostUpdate(now);
    for (const c of chargers) {
      const v = system.getMovementOverride(c.enemy);
      if (v) { c.sprite.x += v.vx * FRAME_MS / 1000; c.sprite.y += v.vy * FRAME_MS / 1000; }
      const phase = c.charge().phase;
      if (phase === 'windup' && previousPhase.get(c.enemy.id) !== 'windup') counts.starts++;
      // Back to the start line after each charge so the next one can trigger.
      if (phase === 'none' && previousPhase.get(c.enemy.id) === 'recover') c.sprite.x = 0;
      previousPhase.set(c.enemy.id, phase);
      expect(c.charge().lane?.length ?? 0).toBeLessThanOrEqual(config.maxRunPx);
    }
  }
  previousPhase = new Map();
  system.clear();
  return { counts, struckPerCharge, chargers, system };
}

describe('shield charger stress (counted work, not wall time)', () => {
  for (const count of [1, 2, 4, 8, 16, 32, 64]) for (const players of [1, 4]) {
    it(`${count} chargers, ${players} player(s): bounded work and one strike per target and charge`, () => {
      const { counts, struckPerCharge, chargers, system } = run(count, players);
      const ticks = Math.floor(DURATION_MS / FRAME_MS) + 1;
      const maxStartsPerCharger = Math.floor(DURATION_MS / config.cooldownMs) + 1;
      expect(counts.starts).toBeGreaterThanOrEqual(count);
      expect(counts.starts).toBeLessThanOrEqual(count * maxStartsPerCharger);
      // Target reads only while idle, lane geometry only per start, contact scans only during runs.
      expect(counts.readTarget).toBeLessThanOrEqual(count * ticks);
      expect(counts.laneClearance).toBe(counts.starts);
      const runTicks = Math.ceil((config.maxRunPx / config.runSpeedPx * 1000 + 250) / FRAME_MS) + 2;
      expect(counts.contactTargets).toBeLessThanOrEqual(counts.starts * runTicks);
      expect([...struckPerCharge.values()].every(hits => hits === 1)).toBe(true);
      expect(counts.strikes).toBeLessThanOrEqual(counts.starts * players);
      // Teardown leaves no charge, override or shield behind.
      for (const c of chargers) {
        expect(c.charge().phase).toBe('none');
        expect(system.getMovementOverride(c.enemy)).toBeNull();
        expect(system.getFrontalShield(c.enemy.id)).toBeNull();
      }
    });
  }
});
