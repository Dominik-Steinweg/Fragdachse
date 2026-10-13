import { describe, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ now: 1000 }));
vi.mock('../../src/network/bridge', () => ({ bridge: {
  getSynchronizedNow: () => clock.now, isArenaCountdownActive: () => false,
  getActivityDescriptor: () => null, getActiveGameMode: () => 'coop_defense',
  getConnectedPlayers: () => [], getLocalPlayerId: () => 'headless',
  getPlayerHeldItemId: () => null, getPlayerInput: () => null, flushEffects() {},
  getPlayerColor: () => 0xffffff, broadcastExplosionEffect() {},
} }));
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url), root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  const Line = require(root + 'src/geom/line/Line.js');
  return { ...phaser, Math: { ...phaser.Math, Distance: { ...phaser.Math.Distance,
    Squared: (x1: number, y1: number, x2: number, y2: number) => (x2 - x1) ** 2 + (y2 - y1) ** 2,
  } }, Geom: { ...phaser.Geom,
    Intersects: require(root + 'src/geom/intersects/index.js'),
    Circle: require(root + 'src/geom/circle/Circle.js'),
    Rectangle: require(root + 'src/geom/rectangle/Rectangle.js'),
    Line: Object.assign(Line, { Length: (l: any) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) }) } };
});

import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { EnergyShieldSystem } from '../../src/systems/EnergyShieldSystem';
import type { EnemyFrontalShieldPort, EnemyFrontalShieldState } from '../../src/systems/enemyFrontalShield';
import { SHOOTING_RANGE } from '../../src/shootingRange/ShootingRangeLayout';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';
import { createSingleOwnerProvenance } from '../../src/projectile/ProjectileSpawnRequest';
import { healthBarTestScene } from '../healthBarTestScene';
import { fakeEntity } from '../fakeEntity';
import type { ShieldBlockCategory } from '../../src/types';

const WEST = Math.PI;
const EAST = 0;

/**
 * A shielded enemy at (300, 100) and an unshielded one behind it at (400, 100). The shooter
 * stands west of both, so a shield facing west is frontal to every attack it makes.
 */
function fixture() {
  clock.now = 1000;
  const scene = healthBarTestScene().scene;
  const existing = scene.physics.add.existing;
  scene.physics.add.existing = (object: { body: object }) => {
    existing(object); Object.assign(object.body, { setImmovable() {} });
  };
  const configs = resolveCoopDefenseEnemyConfigs(1);
  const kind = SHOOTING_RANGE.enemyKind as keyof typeof configs;
  configs[kind] = { ...configs[kind], glow: undefined, deathSpawns: [] };
  const enemies = new EnemyManager(scene, configs);
  const player = fakeEntity({ id: 'p1', x: 100, y: 100, active: true, rotation: 0, color: 0xffffff,
    body: { velocity: { x: 0, y: 0 } } });
  for (const name of ['updateHP', 'updateArmor', 'updateBurnStacks', 'setVisible', 'setTurretMounted',
    'setWalking', 'setRageTint', 'setDecoyStealth', 'setHeldItemId', 'syncBar', 'setMovementDashPhase', 'setBurrowPhase']) player[name] = () => {};
  const players = { getPlayer: (id: string) => id === 'p1' ? player : undefined, getAllPlayers: () => [player] };
  const network = { isHost: () => true, getPlayerProfile: players.getPlayer, areTeammates: () => false,
    getLatestGameState: () => null, getLocalPlayerId: () => 'p1', isEnemyPair: () => true, getPlayerInput: () => null,
    broadcastEffect: vi.fn(), broadcastAudioFeedback: vi.fn(), broadcastHitscanTracer: vi.fn(), broadcastMeleeSwing: vi.fn() };
  const combat = new WorldCombatCore(players as never, network as never);
  combat.bindPlayerVitalsScope({ worldRevision: 71, runtimeGeneration: 1 });
  combat.bindHostExecutionSources({ nowMs: () => clock.now, random: () => 0 });
  combat.initPlayer('p1'); combat.setEnemyManager(enemies);
  combat.setWorldMetrics({ ...resolveCoopDefenseWorldMetrics(64, 32), offsetX: 0, offsetY: 0 });
  const spawn = (x: number) => {
    const enemy = enemies.hostSpawnAtWorld(x, 100, kind);
    enemies.hostSetVitalsBaseline(enemy.id, 100, 100);
    Object.assign(enemy.sprite, { getBounds: () => ({ left: x - 10, top: 90, right: x + 10, bottom: 110 }) });
    return enemy;
  };
  const shielded = spawn(300), behind = spawn(400);

  const shieldBuff = { addBlockedDamage: vi.fn() };
  const energyShield = new EnergyShieldSystem(players as never, {} as never, network as never, shieldBuff as never);
  energyShield.setEnemyManager(enemies);
  combat.setEnergyShieldSystem(energyShield);
  const raised = new Map<string, EnemyFrontalShieldState>();
  const port = {
    getFrontalShield: (id: string) => raised.get(id) ?? null,
    onFrontalShieldBlocked: vi.fn(),
    forEachFrontalShield: (visit: (id: string, shield: EnemyFrontalShieldState) => void) => raised.forEach((s, id) => visit(id, s)),
  } satisfies EnemyFrontalShieldPort;
  combat.setEnemyFrontalShieldPort(port);
  const raise = (facing: number, arcDegrees = 120) => raised.set(shielded.id, { facing, arcDegrees });
  const hp = () => [shielded.getHp(), behind.getHp()];

  const hitscan = (patch: Record<string, unknown> = {}) => combat.resolveImmediateAttack({
    kind: 'hitscan',
    payload: { shooterId: 'p1', startX: 100, startY: 100, angle: 0, range: 500, damage: 10, traceThickness: 4,
      color: 0xffffff, adrenalinGain: 0, sourceId: 'test.hitscan', visualPreset: 'default', rockDamageMult: 1,
      trainDamageMult: 1, baseDamageMult: 0, ...patch } as never,
    origin: { x: 100, y: 100 }, aim: { x: 1, y: 0 }, range: 500,
  });
  const melee = (x: number, angle: number) => combat.resolveImmediateAttack({
    kind: 'melee',
    payload: { shooterId: 'p1', x, y: 100, angle, range: 40, arcDegrees: 90, damage: 10, adrenalinGain: 0,
      sourceId: 'test.melee', color: 0xffffff, rockDamageMult: 1, trainDamageMult: 1, baseDamageMult: 0 } as never,
    origin: { x, y: 100 }, aim: { x: Math.cos(angle), y: Math.sin(angle) }, range: 40,
  });
  const projectile = (impactX: number, velocityX: number) => combat.resolveDirectImpact({
    projectileId: 900 + Math.round(impactX), target: { kind: 'enemy', id: shielded.id },
    impact: { x: impactX, y: 100 }, velocity: { x: velocityX, y: 0 },
    provenance: createSingleOwnerProvenance('p1', { weaponSourceId: 'test.projectile', sourceSlot: 'weapon1' }),
    directHit: { damage: 10 }, augments: [],
  } as never);

  return { enemies, combat, energyShield, port, raised, shielded, behind, shieldBuff, raise, hp, hitscan, melee, projectile, network,
    destroy() { enemies.destroy(); } };
}

describe('enemy frontal shield combat', () => {
  it('absorbs a frontal projectile without damage but lets a projectile from behind through', () => {
    const f = fixture();
    try {
      f.raise(WEST);
      expect(f.projectile(290, 400)).toEqual({ accepted: true, blocked: true, actualDamage: 0, defense: { kind: 'absorbed' } });
      expect(f.hp()).toEqual([100, 100]);
      expect(f.port.onFrontalShieldBlocked).toHaveBeenCalledWith(f.shielded.id, expect.any(Number));
      expect(f.shieldBuff.addBlockedDamage).not.toHaveBeenCalled();

      const back = f.projectile(310, -400);
      expect(back).toMatchObject({ accepted: true, actualDamage: 10 });
      expect(back).not.toHaveProperty('defense');
      expect(f.hp()).toEqual([90, 100]);
    } finally { f.destroy(); }
  });

  it('ends a frontal hitscan at the shielded enemy without reaching the target behind it', () => {
    const f = fixture();
    try {
      f.raise(WEST);
      expect(f.hitscan().accepted).toBe(true);
      expect(f.hp()).toEqual([100, 100]);
      // The tracer still stops at the shielded body instead of passing through.
      const [, , endX, endY] = vi.mocked(f.network.broadcastHitscanTracer).mock.calls.at(-1)!;
      expect(endY).toBe(100);
      expect(endX).toBeGreaterThan(250);
      expect(endX).toBeLessThan(300);

      f.raise(EAST);
      f.hitscan();
      expect(f.hp()).toEqual([90, 100]);
    } finally { f.destroy(); }
  });

  it('blocks a frontal melee swing and not one from the flank', () => {
    const f = fixture();
    try {
      f.raise(WEST);
      f.melee(270, 0);
      expect(f.hp()).toEqual([100, 100]);
      f.raise(-Math.PI / 2); // facing north: a swing from the west is 90° off the 120° arc
      f.melee(270, 0);
      expect(f.hp()).toEqual([90, 100]);
    } finally { f.destroy(); }
  });

  it('blocks radial and projectile explosions whose centre lies in the arc', () => {
    const f = fixture();
    try {
      f.raise(WEST);
      f.combat.applyAoeDamage(260, 100, 60, 10, 'p1', false, { baseDamageMult: 0 });
      f.combat.applyExplosionDamage(260, 100, { radius: 60, maxDamage: 10, knockback: 0, selfDamageMult: 0,
        damageTarget: 'enemies' } as never, 'p1');
      expect(f.hp()).toEqual([100, 100]);

      // Same blast behind the shield: both radial paths hit.
      f.combat.applyAoeDamage(340, 100, 45, 10, 'p1', false, { baseDamageMult: 0 });
      f.combat.applyExplosionDamage(340, 100, { radius: 45, maxDamage: 10, knockback: 0, selfDamageMult: 0,
        damageTarget: 'enemies' } as never, 'p1');
      expect(f.shielded.getHp()).toBe(80);
    } finally { f.destroy(); }
  });

  it('never blocks damage over time, even from the front', () => {
    const f = fixture();
    try {
      f.raise(WEST);
      f.combat.applyAoeDamage(260, 100, 60, 10, 'p1', false, { baseDamageMult: 0, damageKind: 'ground' });
      expect(f.shielded.getHp()).toBe(90);
      expect(f.energyShield.tryBlockDamage({ targetId: f.shielded.id, category: 'damage_over_time', damage: 5,
        sourceX: 200, sourceY: 100, now: clock.now })).toBe(false);
    } finally { f.destroy(); }
  });

  it('stops a chain lightning jump at a frontal shield', () => {
    const f = fixture();
    try {
      // A shot from the east hits the unshielded enemy first; its jump starts east of the shield.
      const chainShot = { angle: Math.PI, startX: 500,
        chainLightning: { maxJumps: 1, searchRadius: 150, damageFalloffPerJump: 0, targetEnemies: true } };
      f.raise(EAST);
      f.hitscan(chainShot);
      expect(f.behind.getHp()).toBe(90);
      expect(f.shielded.getHp()).toBe(100);

      f.raise(WEST);
      f.hitscan(chainShot);
      expect(f.behind.getHp()).toBe(80);
      expect(f.shielded.getHp()).toBe(90);
    } finally { f.destroy(); }
  });

  it('keeps a lowered shield, a cleared port and every category from the side unchanged', () => {
    const f = fixture();
    try {
      const categories: ShieldBlockCategory[] = ['projectile', 'hitscan', 'melee', 'explosion', 'tesla'];
      const attempt = (category: ShieldBlockCategory, sourceX: number, sourceY: number) => f.energyShield.tryBlockDamage({
        targetId: f.shielded.id, category, damage: 5, sourceX, sourceY, now: clock.now });
      expect(categories.map(c => attempt(c, 200, 100))).toEqual(categories.map(() => false));
      f.raise(WEST);
      expect(categories.map(c => attempt(c, 200, 100))).toEqual(categories.map(() => true));
      expect(categories.map(c => attempt(c, 400, 100))).toEqual(categories.map(() => false));
      expect(categories.map(c => attempt(c, 300, 0))).toEqual(categories.map(() => false));
      f.combat.setEnemyFrontalShieldPort(null);
      expect(categories.map(c => attempt(c, 200, 100))).toEqual(categories.map(() => false));
      f.projectile(290, 400);
      expect(f.shielded.getHp()).toBe(90);
    } finally { f.destroy(); }
  });
});
