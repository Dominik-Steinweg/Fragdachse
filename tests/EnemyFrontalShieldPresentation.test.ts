import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const phaser = (await import('./fakeArenaRenderScene')).createFakePhaserModule() as { Math: Record<string, unknown> };
  return { ...phaser, Math: { ...phaser.Math,
    DegToRad: (degrees: number) => degrees * Math.PI / 180,
    Angle: { ...(phaser.Math.Angle as object), RotateTo: (_current: number, target: number) => target },
  } };
});
/** Chainable stand-in for every Phaser display object and emitter the shield visual touches. */
const chain = vi.hoisted(() => {
  const make = (): unknown => new Proxy(function () {}, {
    get: (_target, key) => key === 'then' ? undefined : make(),
    apply: () => make(),
  });
  return make;
});
vi.mock('../src/effects/EffectUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/effects/EffectUtils')>()),
  configureAdditiveImage: (image: unknown) => image,
  createEmitter: () => chain(),
  destroyEmitter: () => {},
  registerGraphicsObject: () => {},
}));

import { ALLIED_COLOR, VOID_PALETTE } from '../src/config';
import { WEAPON_CONFIGS, type EnergyShieldWeaponFireConfig } from '../src/loadout/LoadoutConfig';
import { EnergyShieldSystem } from '../src/systems/EnergyShieldSystem';
import { EnergyShieldRenderer } from '../src/effects/EnergyShieldRenderer';
import type { EnemyFrontalShieldState } from '../src/systems/enemyFrontalShield';
import type { SyncedEnergyShield } from '../src/types';

const FIRE = WEAPON_CONFIGS.ENERGY_SHIELD.fire as EnergyShieldWeaponFireConfig;

function shieldSystem() {
  const player = { id: 'p1', x: 0, y: 0, rotation: 0, active: true };
  const players = { getPlayer: (id: string) => id === 'p1' ? player : undefined, getAllPlayers: () => [player] };
  const bridge = { getPlayerInput: () => null, areTeammates: () => false };
  const resources = { getAdrenaline: () => 100, drainAdrenaline: vi.fn() };
  const shieldBuff = { addBlockedDamage: vi.fn() };
  const system = new EnergyShieldSystem(players as never, resources as never, bridge as never, shieldBuff as never);
  const enemies = new Map<string, { id: string; faction: 'hostile' | 'allied'; sprite: { x: number; y: number; active: boolean };
    getCollisionRadius(): number }>();
  const addEnemy = (id: string, faction: 'hostile' | 'allied', x: number, y: number, radius = 10) => {
    const enemy = { id, faction, sprite: { x, y, active: true }, getCollisionRadius: () => radius };
    enemies.set(id, enemy);
    return enemy;
  };
  system.setEnemyManager({ getEnemy: (id: string) => enemies.get(id), getAlliedEnemies: () => [] } as never);
  const raised = new Map<string, EnemyFrontalShieldState>();
  const port = {
    getFrontalShield: (id: string) => raised.get(id) ?? null,
    onFrontalShieldBlocked: vi.fn(),
    forEachFrontalShield: (visit: (id: string, shield: EnemyFrontalShieldState) => void) => raised.forEach((s, id) => visit(id, s)),
  };
  return { system, player, shieldBuff, addEnemy, raised, port };
}

describe('player directional energy shield', () => {
  it('still blocks only frontal attacks of its blockable categories and feeds the shield buff', () => {
    const { system, player, shieldBuff } = shieldSystem();
    player.rotation = Math.PI / 2; // aim south
    system.hostRefresh('p1', 0, WEAPON_CONFIGS.ENERGY_SHIELD as never, 0xffffff);
    const block = (category: 'projectile' | 'damage_over_time', sourceX: number, sourceY: number) =>
      system.tryBlockDamage({ targetId: 'p1', category, damage: 7, sourceX, sourceY, now: 0 });

    expect(block('projectile', 0, 50)).toBe(true);
    expect(block('projectile', 40, 40)).toBe(true); // 45° off the aim, inside the 120° arc
    expect(block('projectile', 50, 10)).toBe(false); // ~79° off the aim
    expect(block('projectile', 0, -50)).toBe(false);
    expect(block('damage_over_time', 0, 50)).toBe(false);
    expect(shieldBuff.addBlockedDamage).toHaveBeenCalledTimes(2);
  });
});

describe('enemy frontal shield replication', () => {
  it('appends each raised enemy shield with faction colour, facing and authored shield visuals', () => {
    const { system, addEnemy, raised, port } = shieldSystem();
    addEnemy('hostile', 'hostile', 300, 100, 20);
    addEnemy('ally', 'allied', 500, 100, 4);
    const hidden = addEnemy('hidden', 'hostile', 700, 100);
    hidden.sprite.active = false;
    system.setEnemyFrontalShieldPort(port);
    raised.set('hostile', { facing: Math.PI, arcDegrees: 120 });
    raised.set('ally', { facing: 0, arcDegrees: 90 });
    raised.set('hidden', { facing: 0, arcDegrees: 120 });

    const synced = system.hostUpdate(1000);
    expect(synced).toEqual([
      { ownerId: 'hostile', ownerKind: 'enemy', x: 300 - FIRE.anchorDistance, y: 100, angle: Math.PI,
        anchorDistance: FIRE.anchorDistance, radius: 20 + FIRE.visualThickness, thickness: FIRE.visualThickness,
        arcDegrees: 120, color: VOID_PALETTE.primary, alpha: FIRE.visualInnerAlpha, flashAlpha: 0, isDome: false },
      { ownerId: 'ally', ownerKind: 'enemy', x: 500 + FIRE.anchorDistance, y: 100, angle: 0,
        anchorDistance: FIRE.anchorDistance, radius: FIRE.visualRadius, thickness: FIRE.visualThickness,
        arcDegrees: 90, color: ALLIED_COLOR, alpha: FIRE.visualInnerAlpha, flashAlpha: 0, isDome: false },
    ]);
  });

  it('flashes after a block, fades with the authored duration and drops lowered shields', () => {
    const { system, addEnemy, raised, port } = shieldSystem();
    addEnemy('e1', 'hostile', 300, 100);
    system.setEnemyFrontalShieldPort(port);
    raised.set('e1', { facing: Math.PI, arcDegrees: 120 });
    expect(system.tryBlockDamage({ targetId: 'e1', category: 'hitscan', damage: 5, sourceX: 100, sourceY: 100, now: 1000 })).toBe(true);
    expect(port.onFrontalShieldBlocked).toHaveBeenCalledWith('e1', 1000);

    expect(system.hostUpdate(1000)[0].flashAlpha).toBeCloseTo(FIRE.flashMaxAlpha);
    expect(system.hostUpdate(1000 + FIRE.flashDurationMs)[0].flashAlpha).toBe(0);
    raised.delete('e1');
    expect(system.hostUpdate(2000)).toEqual([]);
    system.setEnemyFrontalShieldPort(null);
    raised.set('e1', { facing: Math.PI, arcDegrees: 120 });
    expect(system.hostUpdate(3000)).toEqual([]);
  });
});

describe('energy shield renderer owners', () => {
  const entry = (ownerId: string, x: number, ownerKind?: 'enemy'): SyncedEnergyShield => ({
    ownerId, x, y: 100, angle: 0, anchorDistance: 2, radius: 18, thickness: 5, arcDegrees: 120,
    color: 0xffffff, alpha: 0.5, flashAlpha: 0, isDome: false, ...(ownerKind ? { ownerKind } : {}),
  });
  const scene = () => ({ add: { image: () => chain(), graphics: () => chain() }, time: { now: 0 } });
  const position = (renderer: EnergyShieldRenderer, ownerId: string) => {
    const visual = (renderer as unknown as { visuals: Map<string, { currentX: number; currentY: number }> }).visuals.get(ownerId)!;
    return { x: visual.currentX, y: visual.currentY };
  };

  it('follows enemy bodies for enemy shields and plays the activation sound only for players', () => {
    const renderer = new EnergyShieldRenderer(scene() as never);
    const audio = { playSound: vi.fn() };
    renderer.setAudioSystem(audio as never);
    // A player lookup answers every id, so routing — not lookup failure — picks the enemy body.
    renderer.setOwnerPositionProvider(() => ({ x: 10, y: 20 }));
    renderer.setEnemyPositionProvider((id) => id === 'e1' ? { x: 500, y: 200 } : null);

    renderer.syncVisuals([entry('p1', 0), entry('e1', 300, 'enemy'), entry('e2', 700, 'enemy')]);
    expect(audio.playSound).toHaveBeenCalledExactlyOnceWith('sfx_shield_activate', 0, 100, 'p1');

    renderer.update(16);
    expect(position(renderer, 'p1')).toEqual({ x: 12, y: 20 });
    expect(position(renderer, 'e1')).toEqual({ x: 502, y: 200 });
    // An enemy without a resolvable body keeps the replicated anchor.
    expect(position(renderer, 'e2')).toEqual({ x: 700, y: 100 });
  });
});
