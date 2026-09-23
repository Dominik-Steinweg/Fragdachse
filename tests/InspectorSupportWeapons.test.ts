import { PlasmaBurnerRuntime } from '../src/world/PlasmaBurnerRuntime';
import { getHitscanRangeToCursor } from '../src/loadout/WeaponFireExecutor';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { ENERGY_INJECTOR_COLOR, getTopDownMuzzleOrigin, PLASMA_BURNER_COLOR } from '../src/config';
import { EnergyInjectorSystem } from '../src/systems/EnergyInjectorSystem';
import { getLoadoutItemName } from '../src/i18n/contentPresentation';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';

function createManagerWithSpawnSpy() {
  const spawnProjectile = vi.fn((_request: ProjectileSpawnRequest) => 42);
  const resolveImmediateAttack = vi.fn(() => ({ accepted: true }));
  const sharedExecution = new WorldWeaponExecutionRuntime({
    projectileSpawn: { spawnProjectile },
    combatSystem: {
      resolveSafeHitscanStart: vi.fn((_shooterX, _shooterY, startX, startY) => ({ x: startX, y: startY })),
      resolveImmediateAttack,
    },
  });
  const adapter = new AutomatedWeaponExecutionAdapter(sharedExecution, { spawnProjectile });
  return { adapter, spawnProjectile, resolveImmediateAttack };
}

describe('inspector support weapons', () => {
  it('routes support pulses through the dedicated host owner and rejects generic hitscan execution', () => {
    const config=WEAPON_CONFIGS.PLASMA_BURNER;
    expect(config.range).toBe(300);
    expect(getLoadoutItemName(config.id, 'de').trim().length).toBeGreaterThan(0);
    expect(config.fire).toMatchObject({type:'hitscan',supportEffect:{type:'plasma_burner',beamColor:PLASMA_BURNER_COLOR}});
    const {adapter,resolveImmediateAttack}=createManagerWithSpawnSpy();
    expect(()=>adapter.fire(config,{x:0,y:0,angle:0,targetX:100,targetY:0,ownerId:'i',ownerColor:0xffffff})).toThrow('PlasmaBurnerRuntime');
    expect(resolveImmediateAttack).not.toHaveBeenCalled();
    const resolvePlasmaBurnerPulse=vi.fn(()=>({accepted:true,contacts:[],chainMemberKeys:[],lock:null}));
    const runtime=new PlasmaBurnerRuntime({resolvePlasmaBurnerPulse},{spawnProjectile:vi.fn()});
    expect(runtime.firePulse({playerId:'i',config,nowMs:0,x:0,y:0,angle:0,targetX:100,targetY:0})).toBe(true);
    expect(resolvePlasmaBurnerPulse).toHaveBeenCalledOnce();
  });

  it('retains the cursor limit within its maximum range', () => {
    const config=WEAPON_CONFIGS.PLASMA_BURNER;
    expect(getHitscanRangeToCursor(config,20,0,0,100,0)).toBe(80);
    expect(getHitscanRangeToCursor(config,20,0,0,1000,0)).toBe(300);
  });

  it('fires the energy injector as a precise non-homing projectile', () => {
    const { adapter, spawnProjectile } = createManagerWithSpawnSpy();

    adapter.fire(
      WEAPON_CONFIGS.ENERGY_INJECTOR,
      { x: 0, y: 0, angle: 0, targetX: 400, targetY: 0, ownerId: 'inspector', ownerColor: 0xffffff },
    );

    const [request] = spawnProjectile.mock.calls[0];
    expect(request.interaction.directHit?.damage ?? 0).toBe(0);
    expect(request.flight.homing).toBeUndefined();
    const payload = request.interaction.support?.energyInjector;
    expect(payload).toMatchObject({ color: ENERGY_INJECTOR_COLOR });
    expect(payload!.durationMs).toBeGreaterThan(0);
    expect(payload!.focusDurationMs).toBe(payload!.durationMs);
    expect(payload!.vulnerabilityBonus).toBeGreaterThan(0);
  });
});

describe('energy injector target state', () => {
  const payload = {
    durationMs: 7_000,
    focusDurationMs: 7_000,
    vulnerabilityBonus: 0.2,
    color: ENERGY_INJECTOR_COLOR,
  } as const;

  it('replaces a construction effect instead of stacking it', () => {
    const system = new EnergyInjectorSystem();
    system.applyConstructionEffect('7', 'inspector', 100, 100, { type: 'damage_turret', damageMultiplier: 1.25 }, payload, 0);
    system.applyConstructionEffect('7', 'inspector', 100, 100, { type: 'damage_turret', damageMultiplier: 1.5 }, payload, 200);

    expect(system.getActiveEffects()).toHaveLength(1);
    expect(system.getEffect('7', 200)?.effect).toEqual({ type: 'damage_turret', damageMultiplier: 1.5 });
    expect(system.getTurretDamageMultiplierAt(100, 100, 200)).toBe(1.5);
  });

  it('keeps one focus target per Inspector and refreshes it on a new target', () => {
    const system = new EnergyInjectorSystem();
    system.setFocusTarget('inspector', { targetType: 'enemy', targetId: 'a' }, 7_000, 0);
    system.setFocusTarget('inspector', { targetType: 'base', targetId: 'base:red' }, 7_000, 200);

    expect(system.getNetFocusSnapshot(200)).toEqual([{
      ownerId: 'inspector',
      targetType: 'base',
      targetId: 'base:red',
      startedAt: 200,
      expiresAt: 7_200,
    }]);
  });
});
