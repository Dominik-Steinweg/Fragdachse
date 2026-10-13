import { describe, expect, it, vi } from 'vitest';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { CoopDefenseEnergyConeSystem, type EnergyConePorts, type EnergyConeTarget } from '../src/systems/CoopDefenseEnergyConeSystem';
import { EMPTY_ENERGY_CONE_STATE, ENERGY_CONE_CLIP_RAYS, energyConeRayAngle, isEnergyConeState,
  quantizeEnergyConeReach, type EnergyConeState } from '../src/systems/EnergyConeState';
import type { EnemyEntity } from '../src/entities/EnemyEntity';

vi.mock('phaser', () => ({}));

const config = getCoopDefenseEnemyConfig('alien-badger').energyCone!;
const distance = (config.triggerMinDistancePx + config.triggerMaxDistancePx) / 2;

function fixture() {
  let cone: EnergyConeState = EMPTY_ENERGY_CONE_STATE;
  const published: EnergyConeState[] = [];
  const actor = {
    id: 'e1', kind: 'alien-badger', faction: 'hostile', sprite: { active: true, x: 40, y: -20 },
    getHp: vi.fn(() => 100), isBurrowed: vi.fn(() => false), getSpecialAction: vi.fn(() => 'none'),
    getDashPhase: vi.fn(() => 0), faceAngle: vi.fn(), stopMovement: vi.fn(),
    getEnergyConeState: () => cone,
    applyEnergyConeState: (state: EnergyConeState) => {
      published.push(state);
      if (isEnergyConeState(state) && state.revision > cone.revision) cone = state;
    },
  };
  const enemy = actor as unknown as EnemyEntity;
  const enemies = [enemy];
  const target = { x: actor.sprite.x + distance, y: actor.sprite.y };
  const bodies: EnergyConeTarget[] = [{ id: 'p1', ...target, radius: 16 }];
  const readTarget = vi.fn<EnergyConePorts['readTarget']>(() => target);
  const impulseTargets = vi.fn<EnergyConePorts['impulseTargets']>(() => bodies);
  const impulse = vi.fn<EnergyConePorts['impulse']>(() => true);
  const measureRay = vi.fn<EnergyConePorts['measureRay']>((_x, _y, _angle, length) => length);
  const hasClearLineOfFire = vi.fn(() => true), isStunned = vi.fn(() => false);
  const system = new CoopDefenseEnergyConeSystem({ enemies: { getAllEnemies: () => enemies },
    combat: { hasClearLineOfFire, isStunned }, readTarget, impulseTargets, measureRay, impulse });
  return { actor, enemy, enemies, system, target, bodies, readTarget, impulseTargets, impulse, measureRay,
    hasClearLineOfFire, isStunned, published, cone: () => cone };
}

function expectFree(f: ReturnType<typeof fixture>) {
  expect(f.system.getPhase(f.enemy.id)).toBe('none');
  expect(f.system.getAttack(f.enemy.id)).toBeNull();
  expect(f.system.blocksRegularAttacks(f.enemy.id)).toBe(false);
  expect(f.system.blocksDodge(f.enemy.id)).toBe(false);
  expect(f.system.getMovementOverride(f.enemy)).toBeNull();
  expect(f.cone()).toMatchObject({ phase: 'none', attack: null });
}

describe('energy cone host decisions', () => {
  it.each([
    ['too close', (f: ReturnType<typeof fixture>) => { f.target.x = f.actor.sprite.x + config.triggerMinDistancePx - 1; }],
    ['too far', (f: ReturnType<typeof fixture>) => { f.target.x = f.actor.sprite.x + config.triggerMaxDistancePx + 1; }],
    ['no target', (f: ReturnType<typeof fixture>) => { f.readTarget.mockReturnValue(null); }],
    ['no sight', (f: ReturnType<typeof fixture>) => { f.hasClearLineOfFire.mockReturnValue(false); }],
    ['stunned', (f: ReturnType<typeof fixture>) => { f.isStunned.mockReturnValue(true); }],
    ['burrowed', (f: ReturnType<typeof fixture>) => { f.actor.isBurrowed.mockReturnValue(true); }],
    ['special action', (f: ReturnType<typeof fixture>) => { f.actor.getSpecialAction.mockReturnValue('fire-lance-charge'); }],
    ['dash windup', (f: ReturnType<typeof fixture>) => { f.actor.getDashPhase.mockReturnValue(1); }],
    ['dash', (f: ReturnType<typeof fixture>) => { f.actor.getDashPhase.mockReturnValue(2); }],
    ['dead', (f: ReturnType<typeof fixture>) => { f.actor.getHp.mockReturnValue(0); }],
    ['inactive', (f: ReturnType<typeof fixture>) => { f.actor.sprite.active = false; }],
    ['no ability', (f: ReturnType<typeof fixture>) => { f.actor.kind = 'zombie-badger'; }],
    ['invalid faction', (f: ReturnType<typeof fixture>) => { f.actor.faction = 'neutral'; }],
  ] as const)('does not start when %s', (_reason, arrange) => {
    const f = fixture(); arrange(f); f.system.hostUpdate(0);
    expectFree(f);
    expect(f.published).toHaveLength(0);
    expect(f.measureRay).not.toHaveBeenCalled();
    expect(f.impulse).not.toHaveBeenCalled();
  });

  it.each(['triggerMinDistancePx', 'triggerMaxDistancePx'] as const)('includes the %s boundary', key => {
    const f = fixture(); f.target.x = f.actor.sprite.x + config[key];
    f.system.hostUpdate(50);
    expect(f.cone().phase).toBe('windup');
    expect(f.hasClearLineOfFire).toHaveBeenCalledWith(f.actor.sprite.x, f.actor.sprite.y, f.target.x, f.target.y);
    expect(f.isStunned).toHaveBeenCalledWith(f.enemy.id, 50);
  });

  it('freezes origin, direction and timeline while only changed quantized cover is republished', () => {
    const f = fixture();
    f.target.x = f.actor.sprite.x; f.target.y = f.actor.sprite.y + distance;
    f.measureRay.mockImplementation((_x, _y, angle, length) => length * (angle < Math.PI / 2 ? 0.25 : 0.75));
    f.system.hostUpdate(0);
    const attack = f.cone().attack!;
    expect(attack).toMatchObject({ originX: 40, originY: -20, angle: Math.PI / 2,
      range: config.rangePx, arcDegrees: config.arcDegrees, startedAt: 0,
      hitAt: config.windupMs, recoverUntil: config.windupMs + config.recoverMs });
    expect(f.actor.faceAngle).toHaveBeenCalledWith(attack.angle);
    expect(f.actor.stopMovement).toHaveBeenCalledOnce();
    expect(f.measureRay).toHaveBeenCalledTimes(ENERGY_CONE_CLIP_RAYS);
    for (let i = 0; i < ENERGY_CONE_CLIP_RAYS; i++) {
      expect(f.measureRay).toHaveBeenNthCalledWith(i + 1, attack.originX, attack.originY, energyConeRayAngle(attack, i), attack.range);
      expect(attack.clip[i]).toBe(quantizeEnergyConeReach(energyConeRayAngle(attack, i) < Math.PI / 2 ? 0.25 : 0.75));
    }
    f.target.x = -1000; f.target.y = -1000;
    f.system.hostUpdate(config.coverRefreshMs);
    expect(f.cone().attack).toEqual(attack);
    expect(f.published).toHaveLength(1);
    f.measureRay.mockReturnValue(config.rangePx / 2);
    f.system.hostUpdate(2 * config.coverRefreshMs - 1);
    expect(f.published).toHaveLength(1);
    f.system.hostUpdate(2 * config.coverRefreshMs);
    expect(f.cone().attack).toEqual({ ...attack, clip: Array(ENERGY_CONE_CLIP_RAYS).fill(quantizeEnergyConeReach(0.5)) });
    expect(f.cone().revision).toBeGreaterThan(f.published[0].revision);
    f.readTarget.mockReturnValue(null);
    f.system.hostUpdate(attack.hitAt);
    expect(f.cone().phase).toBe('recover');
    expect(f.impulseTargets).toHaveBeenCalledWith(f.enemy);
  });

  it.each(['hitAt', 'after recovery'] as const)('resolves one impulse at %s using current sector targets and fixed origin', timing => {
    const f = fixture();
    // Face across the -PI/PI seam; candidate order includes a duplicate and a blocked hit.
    f.target.x = f.actor.sprite.x - distance;
    f.system.hostUpdate(0);
    const attack = f.cone().attack!;
    const at = (id: string, offset: number, reach: number, radius = 16) => ({ id, radius,
      x: attack.originX + Math.cos(attack.angle + offset) * reach,
      y: attack.originY + Math.sin(attack.angle + offset) * reach });
    const half = attack.arcDegrees * Math.PI / 360;
    const inside = at('inside', half / 2, attack.range / 2);
    f.bodies.splice(0, f.bodies.length, inside, inside, at('radial edge', 0, attack.range + 8),
      at('beyond range', 0, attack.range + 17), at('outside angle', half + 0.01, attack.range / 2),
      at('behind', Math.PI, attack.range / 2));
    f.impulse.mockReturnValue(false);
    const now = timing === 'hitAt' ? attack.hitAt : attack.recoverUntil + config.cooldownMs;
    f.system.hostUpdate(now);
    expect(f.impulse.mock.calls.map(call => call[0])).toEqual(['inside', 'radial edge']);
    for (const body of f.bodies.slice(1, 3)) expect(f.impulse).toHaveBeenCalledWith(body.id, f.enemy.id, config.damage,
      attack.originX, attack.originY, body.x, body.y, now);
    f.readTarget.mockReturnValue(null);
    f.system.hostUpdate(now); f.system.hostUpdate(now + 1);
    expect(f.impulse).toHaveBeenCalledTimes(2);
    expect(f.impulseTargets).toHaveBeenCalledOnce();
    expect(f.published.some(state => state.phase === 'recover')).toBe(true);
    if (timing === 'after recovery') expectFree(f);
  });

  it('blocks attacks, dodge and movement only during windup/recovery and counts cooldown from hitAt', () => {
    const f = fixture(); expectFree(f);
    f.system.hostUpdate(0);
    const attack = f.cone().attack!;
    for (const now of [0, attack.hitAt - 1, attack.hitAt, attack.recoverUntil - 1]) {
      f.system.hostUpdate(now);
      expect(f.system.blocksRegularAttacks(f.enemy.id)).toBe(true);
      expect(f.system.blocksDodge(f.enemy.id)).toBe(true);
      expect(f.system.getMovementOverride(f.enemy)).toEqual({ vx: 0, vy: 0 });
    }
    f.system.hostUpdate(attack.recoverUntil); expectFree(f);
    f.system.hostUpdate(attack.hitAt + config.cooldownMs - 1); expectFree(f);
    f.system.hostUpdate(attack.hitAt + config.cooldownMs);
    expect(f.system.getPhase(f.enemy.id)).toBe('windup');
    expect(f.impulse).toHaveBeenCalledOnce();
  });

  it('anchors cooldown to the announced hitAt even when the impulse frame is late', () => {
    const f = fixture(); f.system.hostUpdate(0);
    const attack = f.cone().attack!;
    f.system.hostUpdate(attack.recoverUntil + 1);
    expectFree(f);
    f.system.hostUpdate(attack.hitAt + config.cooldownMs - 1); expectFree(f);
    f.system.hostUpdate(attack.hitAt + config.cooldownMs);
    expect(f.cone().phase).toBe('windup');
  });

  it.each(['stun', 'displacement', 'burrow', 'special action', 'faction'] as const)(
    'cancels on %s before a due impulse and enforces retry lockout', reason => {
      const f = fixture(); f.system.hostUpdate(0);
      if (reason === 'stun') f.isStunned.mockReturnValue(true);
      if (reason === 'displacement') f.actor.sprite.y += config.windupDisplacementCancelPx + 1;
      if (reason === 'burrow') f.actor.isBurrowed.mockReturnValue(true);
      if (reason === 'special action') f.actor.getSpecialAction.mockReturnValue('fire-lance-charge');
      if (reason === 'faction') f.actor.faction = 'allied';
      const cancelledAt = config.windupMs;
      f.system.hostUpdate(cancelledAt); expectFree(f);
      expect(f.impulse).not.toHaveBeenCalled();
      f.isStunned.mockReturnValue(false); f.actor.isBurrowed.mockReturnValue(false);
      f.actor.getSpecialAction.mockReturnValue('none'); f.actor.sprite.y = -20;
      f.system.hostUpdate(cancelledAt + config.cancelLockoutMs - 1); expectFree(f);
      f.system.hostUpdate(cancelledAt + config.cancelLockoutMs);
      expect(f.cone().phase).toBe('windup');
    });

  it.each(['death callback', 'zero hp', 'inactive', 'removed', 'clear'] as const)('releases all state on %s', reason => {
    const f = fixture(); f.system.hostUpdate(0);
    if (reason === 'death callback') { f.system.handleKilled({ id: f.enemy.id }); f.enemies.length = 0; }
    if (reason === 'zero hp') f.actor.getHp.mockReturnValue(0);
    if (reason === 'inactive') f.actor.sprite.active = false;
    if (reason === 'removed') f.enemies.length = 0;
    if (reason === 'clear') { f.system.clear(); f.enemies.length = 0; }
    f.system.hostUpdate(config.windupMs); expectFree(f);
    f.system.hostUpdate(config.windupMs + config.cooldownMs); expectFree(f);
    expect(f.impulse).not.toHaveBeenCalled();
    const revision = f.cone().revision;
    f.system.handleKilled({ id: f.enemy.id }); f.system.clear();
    expect(f.cone().revision).toBe(revision);
  });

  it.each(['death', 'clear'] as const)('does not resurrect an attack when an impulse callback triggers %s', reason => {
    const f = fixture();
    f.bodies.push({ ...f.bodies[0], id: 'p2' });
    f.impulse.mockImplementation(() => {
      if (reason === 'death') f.system.handleKilled({ id: f.enemy.id });
      else f.system.clear();
      return true;
    });
    f.system.hostUpdate(0); f.system.hostUpdate(config.windupMs);
    expectFree(f);
    expect(f.impulse).toHaveBeenCalledOnce();
  });

  it('publishes strictly growing valid revisions across completion, cancellation and clear', () => {
    const f = fixture();
    f.actor.applyEnergyConeState({ revision: 40, phase: 'none', attack: null });
    f.system.hostUpdate(0);
    f.measureRay.mockReturnValue(config.rangePx / 2); f.system.hostUpdate(config.coverRefreshMs);
    f.system.hostUpdate(config.windupMs); f.system.hostUpdate(config.windupMs + config.recoverMs);
    const next = config.windupMs + config.cooldownMs;
    f.system.hostUpdate(next); f.isStunned.mockReturnValue(true); f.system.hostUpdate(next + 1);
    f.isStunned.mockReturnValue(false); f.system.hostUpdate(next + 1 + config.cancelLockoutMs); f.system.clear();
    for (let i = 1; i < f.published.length; i++) {
      expect(f.published[i].revision).toBeGreaterThan(f.published[i - 1].revision);
      expect(isEnergyConeState(f.published[i])).toBe(true);
    }
    expectFree(f);
  });

  it('passes the allied caster to target selection and impulse resolution', () => {
    const f = fixture(); f.actor.faction = 'allied';
    f.system.hostUpdate(0); f.system.hostUpdate(config.windupMs);
    expect(f.readTarget).toHaveBeenCalledWith(f.enemy);
    expect(f.impulseTargets).toHaveBeenCalledExactlyOnceWith(f.enemy);
    expect(f.impulse).toHaveBeenCalledWith('p1', f.enemy.id, config.damage, 40, -20, f.target.x, f.target.y, config.windupMs);
  });
});
