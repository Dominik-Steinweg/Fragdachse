import { describe, expect, it, vi } from 'vitest';
import { StructureOccupancySystem, clampStructurePosition, type StructurePlatform } from '../src/systems/StructureOccupancySystem';
import { clampStructureBody } from '../src/systems/PlayerMovement';
import { getConstructionBounds } from '../src/systems/ConstructionGeometry';
import { WATCHTOWER_OCCUPANCY_RULES } from '../src/config/watchtower';
import { resolveTurretExit } from '../src/systems/TurretControlSystem';
import { scaleWeaponRange } from '../src/loadout/scaleWeaponRange';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { encodePlayerStates, decodePlayerStates } from '../src/network/playerStateCodec';
import type { PlayerNetState } from '../src/types';

const bounds = getConstructionBounds({ constructionId: 'watchtower', gridX: 2, gridY: 3 }, { offsetX: 0, offsetY: 0 });
const platform: StructurePlatform = { id: 8, x: bounds.x, y: bounds.y, footprint: bounds };
function fixture() {
  const actors = new Map(Array.from({ length: WATCHTOWER_OCCUPANCY_RULES.capacity + 1 }, (_, i) => [String(i), { x: bounds.left - 5, y: bounds.y, angle: 0 }]));
  const alive = new Set(actors.keys());
  let enabled = true;
  const enter = vi.fn(), exit = vi.fn(), detach = vi.fn(), kill = vi.fn();
  const system = new StructureOccupancySystem({ getStructures: () => [platform], getActor: id => actors.get(id) ?? null,
    canOccupy: id => alive.has(id), canEnter: () => enabled, enter, exit, detach, kill });
  return { system, enter, exit, detach, kill, actors, alive, block: () => { enabled = false; } };
}

describe('Structure occupancy authority', () => {
  it('admits actors without a class or upgrade gate, enforces capacity and rejects duplicate/stale requests', () => {
    const f = fixture();
    for (let i = 0; i < WATCHTOWER_OCCUPANCY_RULES.capacity; i++) expect(f.system.request(String(i), { action: 'enter', structureId: platform.id })).toBe(true);
    const old = f.system.getState('0')!;
    expect(f.system.request('0', { action: 'enter', structureId: platform.id })).toBe(false);
    expect(f.system.request(String(WATCHTOWER_OCCUPANCY_RULES.capacity), { action: 'enter', structureId: platform.id })).toBe(false);
    expect(f.system.request('0', { action: 'exit', ...old, revision: old.revision + 1 })).toBe(false);
    expect(f.system.request('0', { action: 'exit', ...old })).toBe(true);
    expect(f.system.request('0', { action: 'enter', structureId: platform.id })).toBe(true);
    expect(f.system.getState('0')!.revision).toBeGreaterThan(old.revision);
    expect(f.system.request('0', { action: 'exit', ...old })).toBe(false);
  });

  it('requires a live nearby actor, a live structure and an eligible movement phase', () => {
    const f = fixture();
    expect(f.system.request('missing', { action: 'enter', structureId: platform.id })).toBe(false);
    expect(f.system.request('0', { action: 'enter', structureId: 99 })).toBe(false);
    f.actors.get('0')!.x -= WATCHTOWER_OCCUPANCY_RULES.enterRangePx * 2;
    expect(f.system.request('0', { action: 'enter', structureId: platform.id })).toBe(false);
    f.block();
    expect(f.system.request('1', { action: 'enter', structureId: platform.id })).toBe(false);
  });

  it('releases death/disconnect without teleporting a dead or missing actor', () => {
    const f = fixture();
    f.system.request('0', { action: 'enter', structureId: platform.id });
    f.system.request('1', { action: 'enter', structureId: platform.id });
    f.alive.delete('0'); f.actors.delete('1'); f.system.reconcile();
    expect(f.system.getOccupants(platform.id)).toEqual([]);
    expect(f.exit).not.toHaveBeenCalled(); expect(f.kill).not.toHaveBeenCalled();
  });

  it.each(['damage', 'decay', 'removal', 'teardown'] as const)('handles every occupant before %s removal and is idempotent', cause => {
    const f = fixture();
    f.system.request('0', { action: 'enter', structureId: platform.id });
    f.system.request('1', { action: 'enter', structureId: platform.id });
    f.kill.mockImplementation(() => expect(f.system.getOccupants(platform.id)).toEqual([]));
    f.system.constructionDestroyed(platform.id, cause, 'attacker');
    f.system.constructionDestroyed(platform.id, cause, 'attacker');
    const lethal = cause === 'damage' || cause === 'decay';
    expect(f.kill).toHaveBeenCalledTimes(lethal ? 2 : 0);
    expect(f.exit).toHaveBeenCalledTimes(lethal ? 0 : 2);
    expect(f.detach).toHaveBeenCalledTimes(2);
  });

  it('roundtrips confirmed occupancy and removes it in the next unoccupied snapshot', () => {
    const f = fixture(); f.system.request('0', { action: 'enter', structureId: platform.id });
    const player = { structureOccupancy: f.system.getState('0'), alive: true, burrowPhase: 'idle',
      aim: { revision: 1, isMoving: false, weapon1DynamicSpread: 0, weapon2DynamicSpread: 0 } } as PlayerNetState;
    const encoded = encodePlayerStates({ p: player });
    expect(encoded.p.so).toEqual(player.structureOccupancy);
    expect(decodePlayerStates(encoded).p.structureOccupancy).toEqual(player.structureOccupancy);
    expect(decodePlayerStates(encodePlayerStates({ p: { ...player, structureOccupancy: undefined } })).p.structureOccupancy).toBeUndefined();
  });
});

describe('shared platform geometry', () => {
  it('keeps the centre inside catalog bounds and clips only the outward body velocity', () => {
    for (const [x, y] of [[0, 0], [999, 999], [platform.x, platform.y], [bounds.left, bounds.bottom]]) {
      const point = clampStructurePosition(platform, x, y);
      expect(point.x).toBeGreaterThanOrEqual(bounds.left); expect(point.x).toBeLessThanOrEqual(bounds.right);
      expect(point.y).toBeGreaterThanOrEqual(bounds.top); expect(point.y).toBeLessThanOrEqual(bounds.bottom);
      const run = () => {
        const body = { enable: true, center: { x, y }, halfWidth: 16, halfHeight: 16, velocity: { x: 10, y: 20 },
          position: { set(px: number, py: number) { body.center = { x: px + 16, y: py + 16 }; } }, updateCenter() {},
          setVelocity(vx: number, vy: number) { body.velocity = { x: vx, y: vy }; } };
        clampStructureBody(body as never, platform); return { center: body.center, velocity: body.velocity };
      };
      const result = run(); expect(result.center).toEqual(point);
      expect(result.velocity.x).toBe(point.x === x ? 10 : 0);
      expect(result.velocity.y).toBe(point.y === y ? 20 : 0);
    }
  });
  it('exits beyond the full footprint, even if the entry was inside it', () => {
    const exit = resolveTurretExit(platform, platform, 0, 16, { resolveSafeGroundPoint: (x, y) => ({ x, y }) }, () => ({ x: -1, y: -1 }));
    expect(exit.x).toBeGreaterThan(bounds.right + 16);
    const spawn = { x: -100, y: -100 };
    expect(resolveTurretExit(platform, platform, 0, 16, { resolveSafeGroundPoint: (x, y) => x === platform.x && y === platform.y ? { x, y } : null }, () => spawn, true)).toEqual(spawn);
  });
});

describe('equipped weapon range projection', () => {
  it('memoizes without mutating authored values and scales all resolved weapon fire types', () => {
    for (const config of Object.values(WEAPON_CONFIGS)) {
      const original = JSON.stringify(config), scaled = scaleWeaponRange(config, 1.37);
      expect(scaled.range).toBeCloseTo(config.range * 1.37);
      expect(scaleWeaponRange(config, 1.37)).toBe(scaled);
      expect(scaleWeaponRange(config, 1)).toBe(config);
      expect(scaled.damage).toBe(config.damage); expect(scaled.cooldown).toBe(config.cooldown);
      if (config.fire.type === 'tesla_dome' && scaled.fire.type === 'tesla_dome') {
        expect(scaled.fire.radius).toBeCloseTo(config.fire.radius * 1.37);
        expect(scaled.fire.radiusBonusPerCharge).toBe(config.fire.radiusBonusPerCharge);
      }
      if (config.fire.type === 'energy_shield' && scaled.fire.type === 'energy_shield') expect(scaled.fire.domeRadius).toBeCloseTo(config.fire.domeRadius * 1.37);
      expect(JSON.stringify(config)).toBe(original);
    }
  });
  it('also scales captured flames after fireball conversion', () => {
    const config = { ...WEAPON_CONFIGS.GLOCK, fireballFlameConfig: WEAPON_CONFIGS.GLOCK };
    expect(scaleWeaponRange(config, 1.4).fireballFlameConfig.range).toBeCloseTo(config.fireballFlameConfig.range * 1.4);
  });
});
