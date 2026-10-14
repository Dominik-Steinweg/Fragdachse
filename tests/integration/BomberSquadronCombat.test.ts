import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBomberCombatFixture } from '../BomberSquadronTestHelper';
import { isBomberImpactInWorld } from '../../src/systems/bomberSquadron/BomberSquadronPlan';
import { ATTACK_DRONE_RULES } from '../../src/config/attackDrone';
import { COOP_DEFENSE_ENEMY_KINDS } from '../../src/config/coopDefenseEnemies';
import { WorldPlayerGameplayRuntime } from '../../src/world/WorldPlayerGameplayRuntime';
import { resolveActiveArenaWorldMetrics } from '../../src/world/WorldMetrics';
import { readBomberAimTargets } from '../../src/world/WorldBomberSquadronBinding';
import { ExposedBaseFaceCache } from '../../src/systems/TurretBaseTargeting';
import { CELL_SIZE } from '../../src/config';

let f: ReturnType<typeof createBomberCombatFixture>;
afterEach(() => { f?.destroy(); vi.restoreAllMocks(); });

describe('Bomber plan → captured combat', () => {
  it('reads living hostile enemies and exposed base cells once, including world offsets', () => {
    f = createBomberCombatFixture();
    const enemy = f.world.spawnEnemy(f.owner.x, f.owner.y);
    const dead = f.world.spawnEnemy(f.owner.x + 100, f.owner.y);
    dead.setHp(0, dead.getHp(), true);
    const ally = f.world.enemies.hostSpawnAllyAtWorld(f.owner.x, f.owner.y, COOP_DEFENSE_ENEMY_KINDS[0], 'inspector', 1, 1);
    const cells = Array.from({ length: 9 }, (_, i) => ({ gridX: i % 3, gridY: Math.floor(i / 3) }));
    let damageable = true;
    const base = { id: 'hostile', isDamageable: () => damageable, isInert: () => false, getHp: () => 100,
      getSpec: () => ({ cells }) };
    const bases = { getBasesByFaction: () => [base], getObstacleGeneration: () => 1 };
    const cache = new ExposedBaseFaceCache();
    const targets = readBomberAimTargets([enemy, dead, ally], bases as never, f.metrics, cache);
    const exposed = cells.filter(c => c.gridX === 0 || c.gridX === 2 || c.gridY === 0 || c.gridY === 2);
    expect(targets).toEqual([{ x: enemy.sprite.x, y: enemy.sprite.y, weight: 1 },
      ...exposed.map(c => ({ x: f.metrics.offsetX + (c.gridX + 0.5) * CELL_SIZE,
        y: f.metrics.offsetY + (c.gridY + 0.5) * CELL_SIZE, weight: 0.5 }))]);
    damageable = false;
    expect(readBomberAimTargets([], bases as never, f.metrics, cache)).toEqual([]);
  });
  it('lands bomber chunks through the player runtime with damage and ground fire but without explosion broadcasts', () => {
    f = createBomberCombatFixture({ fireChunksPerBomb: 3 }); f.activate();
    f.binding.advance(Math.min(...f.plan().map(bomb => bomb.impactAt)));
    const [owner, x, y, burst, key, at, source] = f.chunks.mock.calls[0];
    const service = (values: Record<string, unknown> = {}): any => new Proxy(values, { get(target, property) {
      if (!(property in target)) target[property as string] = vi.fn();
      return target[property as string];
    } });
    const explode = vi.fn(), broadcast = vi.fn(), ground = vi.fn();
    const runtime = new WorldPlayerGameplayRuntime({
      playerManager: service({ getAllPlayers: () => [] }),
      projectileSpawn: service(), projectileTravelReadPort: service({ getTravelSamples: () => [] }),
      projectileEnvironmentInteractionPort: service(), translocatorProjectilePort: service(),
      combatSystem: service({ applyExplosionDamage: explode, hasLineOfSight: () => true }),
      hostPhysics: service({ observeMovementSteps: () => vi.fn() }),
      fireSystem: service({ canPlaceGroundCell: () => true, hostRefreshGroundCell: ground }),
      placementSystem: service({ getAllRuntimeRocks: () => [] }), gameAudioSystem: service(),
      worldMetrics: resolveActiveArenaWorldMetrics(), getEnemyManager: () => null,
      getTargetStatusSystem: () => null, getPowerUpSystem: () => null,
      getPlayerCapabilities: () => ({ canInteract: true } as never), resetPlayerPosition: vi.fn(), dropBeer: vi.fn(),
      createLoadoutManager: () => service(), createBurrowSystem: () => service(), weaponExecution: service(),
      relationship: { isEnemyPair: () => false }, network: { input: service(),
        presentation: service({ broadcastExplosionEffect: broadcast }), loadout: service(), roundStats: service() },
    });
    try {
      runtime.hostCreateFireChunkBurst(owner, x, y, burst, key, at, source);
      runtime.runHostPostProjectileStage(0, at + burst.flightMs, false);
      expect(explode).toHaveBeenCalledTimes(burst.count);
      expect(ground).toHaveBeenCalledTimes(burst.count);
      expect(broadcast).not.toHaveBeenCalled();
      for (const call of explode.mock.calls) expect(call[2]).toMatchObject({ maxDamage: burst.landingExplosion.maxDamage });
      runtime.hostCreateFireChunkBurst(owner, x, y, { ...burst,
        landingExplosion: { ...burst.landingExplosion, suppressExplosionBroadcast: false } }, key, at, source);
      runtime.runHostPostProjectileStage(0, at + burst.flightMs, false);
      expect(broadcast).toHaveBeenCalledTimes(burst.count);
    } finally { runtime.destroy(); }
  });

  it('executes every bomb once through irregular frames with independent fire sources and no explosion broadcast', () => {
    f = createBomberCombatFixture({ secondPassEnabled: 1, fireChunksPerBomb: 3 });
    expect(f.activate()).toEqual({ ok: true });
    const plan = f.plan(), end = Math.max(...plan.map(bomb => bomb.impactAt));
    for (let now = 1000; now < end; now += 317) f.binding.advance(now);
    f.binding.advance(end); f.binding.advance(end + 1000);
    const count = f.config.droneCount * f.config.bombsPerPass * (1 + f.config.secondPassEnabled);
    expect(f.explode).toHaveBeenCalledTimes(count);
    expect(f.chunks).toHaveBeenCalledTimes(count);
    const keys = f.chunks.mock.calls.map(call => call[4]);
    expect(new Set(keys).size).toBe(count);
    for (const [, , , chunk, key, at, source] of f.chunks.mock.calls) {
      expect(chunk).toMatchObject({ count: f.config.fireChunksPerBomb, burnDamagePerTick: ATTACK_DRONE_RULES.burnDamagePerTick,
        landingExplosion: { suppressExplosionBroadcast: true } });
      expect(chunk.landingExplosion.fireChunkBurst).toBeUndefined();
      expect(source).toMatchObject({ sourceSlot: 'ultimate', authoredSourceId: 'BOMBER_SQUADRON.fire', lineage: { parentEffectId: key } });
      expect(plan.some(bomb => bomb.impactAt === at)).toBe(true);
    }
    // Binding has no presentation/network port; combat receipts are the only effects of main bombs.
    expect(f.world.projectile.spawn).not.toHaveBeenCalled();
  });

  it('drops out-of-world bombs using offset bounds instead of clamping them', () => {
    f = createBomberCombatFixture();
    f.owner.x = f.metrics.offsetX + f.metrics.widthPx - f.config.corridorLengthPx / 2;
    f.activate(); const plan = f.plan();
    const expected = plan.filter(b => isBomberImpactInWorld(b.x, b.y, { width: f.metrics.widthPx,
      height: f.metrics.heightPx, offsetX: f.metrics.offsetX, offsetY: f.metrics.offsetY }));
    expect(expected.length).toBeGreaterThan(0); expect(expected.length).toBeLessThan(plan.length);
    f.binding.advance(Math.max(...plan.map(b => b.impactAt)));
    expect(f.explode).toHaveBeenCalledTimes(expected.length);
    expect(f.explode.mock.calls.map(([x, y]) => [x, y]).sort()).toEqual(expected.map(b => [b.x, b.y]).sort());
  });

  it('captures power at drop, retains it until impact, and damages enemies and hostile base surfaces only', () => {
    f = createBomberCombatFixture(); f.setMultiplier(2); f.activate();
    const first = f.plan().sort((a, b) => a.dropAt - b.dropAt)[0];
    const enemy = f.world.spawnEnemy(first.x, first.y);
    const ally = f.world.enemies.hostSpawnAllyAtWorld(first.x, first.y, COOP_DEFENSE_ENEMY_KINDS[0], 'inspector', 1, 1);
    const allyHp = ally.getHp();
    const hp = enemy.getHp(), playerHp = f.world.combat.getHP('inspector');
    f.world.player.x = first.x; f.world.player.y = first.y;
    const original = f.world.add(); const rockHp = f.world.placement.getRuntimeRock(original.id)!.hp;
    const baseDamage = vi.fn(() => null), rockDamage = vi.fn(), trainDamage = vi.fn();
    f.world.combat.setBaseManager({ getBasesByFaction: () => [{ id: 'hostile-base', getHp: () => 10000,
      isInert: () => false, getNearestSurfacePoint: () => ({ x: first.x, y: first.y, distance: 0 }) }],
      getBase: () => ({ faction: 'hostile' }) } as never);
    f.world.combat.setBaseDamageCallback(baseDamage);
    f.world.combat.setRockDamageCallback(rockDamage); f.world.combat.setTrainDamageCallback(trainDamage);
    f.binding.advance(first.dropAt); f.setMultiplier(100); f.binding.advance(first.impactAt);
    const effect = f.explode.mock.calls[0][2];
    expect(effect.maxDamage).toBe(f.config.maxDamage * 2);
    expect(enemy.getHp()).toBeLessThan(hp); expect(baseDamage).toHaveBeenCalled();
    expect(f.world.combat.getHP('inspector')).toBe(playerHp);
    expect(ally.getHp()).toBe(allyHp);
    expect(f.world.placement.getRuntimeRock(original.id)!.hp).toBe(rockHp);
    expect(rockDamage).not.toHaveBeenCalled(); expect(trainDamage).not.toHaveBeenCalled();
    expect(effect).toMatchObject({ damageTarget: 'enemies', excludeFriendlyPlayers: true, selfDamageMult: 0,
      rockDamageMult: 0, trainDamageMult: 0, baseDamageMult: 1, knockback: 0, useTargetSurfaceDistance: true });
  });

  it('executes standalone impacts at their scheduled combat time', () => {
    f = createBomberCombatFixture(); f.activate();
    const observed: number[] = [];
    f.explode.mockImplementation(() => { observed.push(f.world.combat.getHostTime()); return []; });
    const plan = f.plan(); f.binding.advance(Math.max(...plan.map(b => b.impactAt)));
    expect(observed).toEqual(plan.map(b => b.impactAt).sort((a, b) => a - b));
  });

  it.fails('contract wish: nested host execution must honor explicit subframe impact times', () => {
    f = createBomberCombatFixture(); f.activate();
    const observed: number[] = [], plan = f.plan(), end = Math.max(...plan.map(b => b.impactAt));
    f.explode.mockImplementation(() => { observed.push(f.world.combat.getHostTime()); return []; });
    f.world.combat.runHostExecution(() => f.binding.advance(end), end);
    expect(observed).toEqual(plan.map(b => b.impactAt).sort((a, b) => a - b));
  });
});
