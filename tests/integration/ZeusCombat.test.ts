import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const p = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  class Line {
    constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {}
    setTo(x1: number, y1: number, x2: number, y2: number) { Object.assign(this, { x1, y1, x2, y2 }); return this; }
    static Length(l: Line) { return Math.hypot(l.x2 - l.x1, l.y2 - l.y1); }
  }
  return { ...p, Geom: { ...p.Geom, Line } };
});
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { WorldZeusBinding } from '../../src/world/WorldZeusBinding';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { UTILITY_CONFIGS, type TaserUtilityConfig } from '../../src/loadout/LoadoutConfig';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';
import type { ZeusMovement } from '../../src/systems/ZeusRuntime';
import type { ProjectileSpawnRequest } from '../../src/projectile/ProjectileSpawnRequest';
import { HostPhysicsSystem } from '../../src/systems/HostPhysicsSystem';
import { createProjectileRuntimeTestWorld } from '../ProjectileRuntimeTestHelper';

function fixture() {
  let now = 0;
  const kind = COOP_DEFENSE_ENEMY_KINDS[0], configs = resolveCoopDefenseEnemyConfigs(1);
  configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [], imageKey: 'test-enemy' };
  const enemies = new EnemyManager(healthBarTestScene().scene, configs);
  let radius = 8;
  const player = Object.assign(fakeEntity({ id: 'p1', x: 150, y: 100, active: true, color: 0xffffff }),
    { body: { enable: true, velocity: { x: 0, y: 0 }, setVelocity: vi.fn() }, getCollisionRadius: () => radius,
      setCollisionRadius: (value: number) => { radius = value; }, setDashScale: vi.fn(), positionRevision: 0 });
  Object.assign(player, { physicsProxy: player });
  const players = { getPlayer: (id: string) => id === 'p1' ? player : undefined, getAllPlayers: () => [player] };
  const network = { isHost: () => true, getPlayerProfile: players.getPlayer, areTeammates: () => false,
    getWorldParticipation: () => 'interactive', getPlayerInput: () => ({ dx: 1, dy: 0 }),
    getLocalPlayerId: () => 'p1', isEnemyPair: () => true, broadcastEffect: vi.fn(), broadcastMeleeSwing: vi.fn() };
  const combat = new WorldCombatCore(players as never, network as never);
  combat.bindPlayerVitalsScope({ worldRevision: 77, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => now, random: () => 0.5 });
  combat.initPlayer('p1'); combat.setEnemyManager(enemies);
  const hostPhysics = new HostPhysicsSystem(healthBarTestScene().scene, players as never, network as never, combat);
  hostPhysics.setEnemyManager(enemies);
  const projectiles = createProjectileRuntimeTestWorld();
  const spawn = vi.fn((request: ProjectileSpawnRequest) => projectiles.runtime.spawnProjectile(request));
  const binding = new WorldZeusBinding(combat, players as never, () => enemies, hostPhysics,
    { spawnProjectile: spawn }, { setZeusPort: vi.fn(), onZeusDashStarted: vi.fn() } as never);
  const base = UTILITY_CONFIGS.ZEUS_TASER as TaserUtilityConfig;
  const config: TaserUtilityConfig = { ...base, zeus: { ...base.zeus, ballDurationMs: 1500, stormEnabled: 1, stunDurationMs: 50, killRangeBonus: 0.5 } };
  return { binding, combat, enemies, config, spawn, kind, network, player, hostPhysics, projectiles,
    setNow: (value: number) => { now = value; } };
}

describe('Zeus uses the canonical Combat and projectile boundaries', () => {
  it('electrifies ordinary walking, survives dash end and expires without a final contact', () => {
    const f = fixture();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    const enemy = f.enemies.hostSpawnAtWorld(230, 100, f.kind);
    Object.assign(enemy.sprite.body!, { halfWidth: 8 });
    try {
      f.binding.activate(f.config, 'p1', f.player.x, f.player.y, 0, 0xffffff, 0, true);
      const first = f.binding.snapshot(0).balls[0];
      expect(first.expiresAt).toBe(f.config.zeus.ballDurationMs);
      f.player.x = 240; f.setNow(10); f.binding.prepareMovement(10);
      expect(f.combat.isAlive(enemy.id)).toBe(false);
      expect(f.spawn).toHaveBeenCalledTimes(f.config.zeus.boltCount);
      f.hostPhysics.handleDashRPC('p1', 1, 0);
      f.hostPhysics.update(false, 600); f.hostPhysics.update(false, 1200);
      expect(f.binding.snapshot(1200).balls[0]).toMatchObject({ useId: first.useId, expiresAt: first.expiresAt });
      const later = f.enemies.hostSpawnAtWorld(f.player.x, f.player.y, f.kind);
      Object.assign(later.sprite.body!, { halfWidth: 8 });
      f.setNow(first.expiresAt); f.binding.prepareMovement(first.expiresAt);
      expect(f.binding.snapshot(first.expiresAt).balls).toEqual([]);
      expect(f.combat.isAlive(later.id)).toBe(true);
      expect(f.spawn).toHaveBeenCalledTimes(f.config.zeus.boltCount);
    } finally { clock.mockRestore(); f.binding.destroy(); f.enemies.destroy(); f.projectiles.runtime.destroy(); }
  });
  it.each([
    { impact: false, lethal: true }, { impact: true, lethal: true }, { impact: true, lethal: false },
  ])('keeps Thunderfront projectiles after a moving ball contact (impact=$impact, lethal=$lethal)', ({ impact, lethal }) => {
    const f = fixture();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    const enemy = f.enemies.hostSpawnAtWorld(230, 100, f.kind);
    Object.assign(enemy.sprite.body!, { halfWidth: 8 });
    const hp = enemy.getHp();
    const config = { ...f.config, damage: lethal ? hp * 2 : hp / 10 };
    try {
      if (impact) f.hostPhysics.setDashImpactDamageResolver(() => hp * 2);
      f.hostPhysics.handleDashRPC('p1', 1, 0);
      f.binding.activate(config, 'p1', f.player.x, f.player.y, 0, 0xffffff, 0, true);
      // Enter the larger general impact radius before reaching the electrical body.
      f.player.x = 205;
      f.setNow(8); f.binding.refresh(); f.hostPhysics.update(false, 8);
      expect(enemy.getHp()).toBe(hp);
      expect(f.spawn).not.toHaveBeenCalled();
      f.player.x = 240;
      f.setNow(16); f.projectiles.setHostNowMs(16);
      f.binding.refresh(); f.hostPhysics.update(false, 16);
      expect(f.combat.isAlive(enemy.id)).toBe(false);
      expect(f.spawn).toHaveBeenCalledTimes(f.config.zeus.boltCount);
      // A later Dash Impact kill must not count as a lethal Zeus contact.
      for (const [bolt] of f.spawn.mock.calls) expect(bolt.flight.remainingRangePx)
        .toBe(config.zeus.boltRange * (1 + (lethal ? config.zeus.killRangeBonus : 0)));
      f.projectiles.runtime.runHostInteractionStage(16);
      f.projectiles.runtime.runHostProjectileStage(16, 16);
      expect(f.projectiles.runtime.activeCount).toBe(f.config.zeus.boltCount);
    } finally { clock.mockRestore(); f.binding.destroy(); f.enemies.destroy(); f.projectiles.runtime.destroy(); }
  });
  it.each([0, 1])('excludes the owner from ball and ground damage while preserving enemy hits (ground=%s)', groundEnabled => {
    const f = fixture();
    const enemy = f.enemies.hostSpawnAtWorld(180, 100, f.kind);
    Object.assign(enemy.sprite.body!, { halfWidth: 8 });
    const config = { ...f.config, zeus: { ...f.config.zeus, groundEnabled } };
    const dash: ZeusMovement = { playerId: 'p1', positionRevision: 0,
      x: f.player.x, y: f.player.y, radius: f.player.getCollisionRadius() };
    const hp = f.combat.getHP('p1');
    try {
      expect(f.binding.activate(config, 'p1', dash.x, dash.y, 0, 0xffffff, 0, true)).toBe(true);
      expect(f.combat.getHP('p1')).toBe(hp);
      expect(f.combat.isStunned('p1', 1)).toBe(false);
      expect(f.spawn).not.toHaveBeenCalled();
      expect(f.binding.snapshot(0).balls).toHaveLength(1);

      f.player.x = 190;
      f.setNow(10);
      f.binding.prepareMovement(10);
      expect(f.combat.isAlive(enemy.id)).toBe(false);
      expect(f.spawn).toHaveBeenCalledTimes(config.zeus.boltCount);
      f.binding.step(10);
      f.setNow(1010); f.binding.step(1010);
      expect(f.combat.isAlive('p1')).toBe(true);
      expect(f.combat.getHP('p1')).toBe(hp);
      expect(f.binding.runtime.getMoveBonus('p1', 1010)).toBe(groundEnabled ? config.zeus.groundMoveBonus : 0);
    } finally { f.binding.destroy(); f.enemies.destroy(); f.projectiles.runtime.destroy(); }
  });

  it.each([false, true])('secures lethal direct hits before target removal (ball=%s)', ball => {
    const f = fixture(); const enemy = f.enemies.hostSpawnAtWorld(180, 100, f.kind);
    Object.assign(enemy.sprite.body!, { halfWidth: 8 });
    const config = { ...f.config, damage: enemy.getHp() * 2 };
    if (ball) f.player.x = 180;
    try {
      expect(f.binding.activate(config, 'p1', 150, 100, 0, 0xffffff, 0, ball)).toBe(true);
      expect(f.combat.isAlive(enemy.id)).toBe(false);
      expect(f.spawn).toHaveBeenCalledTimes(config.zeus.boltCount);
      for (const [bolt] of f.spawn.mock.calls) {
        expect(bolt.origin).toMatchObject({ x: 180, y: 100 });
        expect(bolt.flight.remainingRangePx).toBe(config.zeus.boltRange * (1 + config.zeus.killRangeBonus));
        expect(bolt.flight.collisionFilter?.excludedTarget).toMatchObject({ id: enemy.id });
        expect(bolt.flight.piercesTargets).toBe(false);
        expect(bolt.provenance.sourceSlot).toBe('utility');
      }
      expect(f.binding.snapshot(0).stuns).toEqual([]);
    } finally { f.binding.destroy(); f.enemies.destroy(); f.projectiles.runtime.destroy(); }
  });
  it('applies outgoing factors once to direct and bolt damage, and bolts only stun', () => {
    const f = fixture(); const enemy = f.enemies.hostSpawnAtWorld(180, 100, f.kind);
    f.combat.setPlayerOutgoingDamageResolver((_owner, _target, amount) => ({ amount: amount * 2, isCritical: false }));
    const initial = enemy.getHp();
    const config = { ...f.config, damage: initial / 10, zeus: { ...f.config.zeus, boltDamage: initial / 10 } };
    try {
      f.binding.activate(config, 'p1', 150, 100, 0, 0xffffff, 0);
      expect(enemy.getHp()).toBeCloseTo(initial - config.damage * 2);
      expect(f.combat.isStunned(enemy.id, 1)).toBe(true);
      const other = f.enemies.hostSpawnAtWorld(220, 100, f.kind), before = other.getHp();
      const bolt = f.spawn.mock.calls[0][0];
      f.setNow(10);
      f.combat.resolveDirectImpact({ projectileId: 2, target: { kind: 'enemy', id: other.id },
        impact: { x: 220, y: 100 }, velocity: { x: 1, y: 0 }, augments: [],
        provenance: bolt.provenance, directHit: bolt.interaction!.directHit! });
      expect(other.getHp()).toBeCloseTo(before - config.zeus.boltDamage * 2);
      expect(f.combat.isStunned(other.id, 11)).toBe(true);
      expect(f.spawn).toHaveBeenCalledTimes(config.zeus.boltCount);
      f.binding.destroy(); expect(f.combat.isStunned(other.id, 11)).toBe(false);
    } finally { f.binding.destroy(); f.enemies.destroy(); f.projectiles.runtime.destroy(); }
  });
});
