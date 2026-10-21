import { describe, expect, it, vi } from 'vitest';
import { navigationTestWorld } from '../navigationTestWorld';
import type { NavigationObstacle } from '../../src/systems/navigation/NavigationGeometry';
import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyKind } from '../../src/config/coopDefenseEnemies';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import type { EnemyEntity } from '../../src/entities/EnemyEntity';
import { getCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { resolveCoopDefensePortalLink } from '../../src/config/coopDefensePortalLinks';
import { PortalLinkSystem } from '../../src/systems/portal/PortalLinkSystem';
import { WorldPortalTransport } from '../../src/systems/portal/WorldPortalTransport';

type Unit = EnemyEntity & { sprite: { x: number; y: number; active: boolean }; positionRevision: number };
function enemy(kind: CoopDefenseEnemyKind, id: string, x: number, y: number): Unit {
  const config = getCoopDefenseEnemyConfig(kind);
  return { id, kind, faction: 'hostile', sprite: { active: true, x, y }, positionRevision: 0,
    getSize: () => config.size, getMoveSpeed: () => config.moveSpeed,
    getAttackWeapons: () => config.weapons.map(w => ({ ...w, weapon: { config: WEAPON_CONFIGS[w.weaponId] } })),
  } as unknown as Unit;
}

/**
 * The generator link, the World transport and the flow fields together: an enemy plans through the
 * open portal, the transport performs the jump, and the fallen generator returns the route to land.
 */
describe('Generator portal links in navigation', () => {
  // 512 x 384 px: a barrier from the top leaves only a passage along the bottom edge.
  const wall: NavigationObstacle = { id: 'wall', kind: 'barrier', shape: 'rect', left: 240, top: 0, right: 272, bottom: 256 };
  const PLAYER = { kind: 'player' as const, id: 'player', x: 464, y: 48 };

  function scene() {
    const world = navigationTestWorld([wall], [], 15, { width: 512, height: 384 });
    const units: Unit[] = [];
    const transport = new WorldPortalTransport({ isAlive: () => true, applyDamage: vi.fn() } as never,
      { broadcastTranslocatorFlash: vi.fn() });
    transport.bindWorld({
      getActors: () => units.map(unit => ({ id: unit.id, kind: 'enemy' as const, x: unit.sprite.x, y: unit.sprite.y,
        radius: unit.getSize() / 2, alive: true, surface: true, revision: unit.positionRevision })),
      canOccupy: (actor, x, y) => world.geometry().isFree(x, y, actor.radius),
      transferActor: (actor, x, y) => {
        const unit = units.find(candidate => candidate.id === actor.id)!;
        unit.sprite.x = x; unit.sprite.y = y; unit.positionRevision++;
      },
      collapseEnemy: vi.fn(),
    });
    const config = resolveCoopDefensePortalLink(getCoopDefenseMapConfig('8').portalLinks![0]);
    let standing = true;
    const links = new PortalLinkSystem({ links: [config],
      endpoints: new Map([[config.id, { a: { x: 96, y: 48 }, b: { x: 416, y: 48 } }]]), transport,
      isGeneratorStanding: () => standing, isHostileEnemy: () => true,
      setNavigationLinks: navigationLinks => world.coordinator.setPortalLinks(navigationLinks), publish: () => {} });
    return { world, units, transport, links, config, fell: () => { standing = false; } };
  }

  function walk(s: ReturnType<typeof scene>, unit: Unit, startMs: number, steps = 600) {
    let jumps = 0, maxY = unit.sprite.y, arrived = false;
    for (let step = 0; step < steps; step++) {
      const now = startMs + step * 16;
      s.world.coordinator.advance(16); s.world.intents.update([unit], now);
      const route = s.world.intents.get(unit.id)?.navigation;
      if (route?.status === 'ready' && route.cost < 1) { arrived = true; break; }
      const point = route?.status === 'ready' ? route.waypoint : route?.status === 'pending' ? route.continuation : undefined;
      if (point) {
        const dx = point.x - unit.sprite.x, dy = point.y - unit.sprite.y, distance = Math.hypot(dx, dy);
        const t = distance > 0 ? Math.min(1, 6 / distance) : 0;
        unit.sprite.x += dx * t; unit.sprite.y += dy * t;
      }
      const revision = unit.positionRevision;
      s.transport.transferActors(now);
      if (unit.positionRevision !== revision) jumps++;
      maxY = Math.max(maxY, unit.sprite.y);
    }
    return { jumps, maxY, arrived };
  }

  it('plans through the open portal and lets the transport carry the enemy to the exit', () => {
    const s = scene(), unit = enemy('rabid-badger', 'flanker', 48, 48);
    s.units.push(unit);
    s.world.catalog.updateTargets([PLAYER]);
    s.links.hostUpdate(s.config.chargeDurationMs, false, 0);
    s.world.intents.update([unit], 0); s.world.flush(); s.world.intents.update([unit], 1);
    const trace = walk(s, unit, 100);
    expect(trace.jumps).toBe(1);
    expect(trace.arrived).toBe(true);
    expect(trace.maxY).toBeLessThan(96);
    s.world.destroy();
  });

  it('returns to the land route once the generator has fallen', () => {
    const s = scene(), unit = enemy('rabid-badger', 'late', 48, 48);
    s.units.push(unit);
    s.world.catalog.updateTargets([PLAYER]);
    s.links.hostUpdate(s.config.chargeDurationMs, false, 0);
    s.world.intents.update([unit], 0); s.world.flush(); s.world.intents.update([unit], 1);
    s.fell();
    s.links.hostUpdate(16, false, 2);
    s.world.intents.update([unit], 10); s.world.flush(); s.world.intents.update([unit], 400);
    expect(s.world.intents.getField(unit.id)!.getNavigationSnapshot()!.portalLinks ?? []).toHaveLength(0);
    const trace = walk(s, unit, 500, 1200);
    expect(trace.jumps).toBe(0);
    expect(trace.arrived).toBe(true);
    expect(trace.maxY).toBeGreaterThan(256);
    s.world.destroy();
  });
});
