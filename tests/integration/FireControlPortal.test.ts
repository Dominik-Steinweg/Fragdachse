import { afterEach, describe, expect, it } from 'vitest';
import { createFireControlProjectileFixture, createFireControlWorldFixture } from '../FireControlTestHelper';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import {
  fireControlContributionId, isFireControlCopySourceId, type FireControlPortalDeploymentSnapshot,
} from '../../src/systems/fireControl/FireControlSnapshot';
import { decodeFireControlSnapshot, encodeFireControlSnapshot } from '../../src/network/fireControlSnapshotCodec';
import type { ProjectileSpawnRequest } from '../../src/projectile/ProjectileSpawnRequest';
import type { ProjectileGrenadePayloadRequest } from '../../src/projectile/ProjectileExplosionPort';

// Durable rules only: sections and transfer details are pinned in FireControlPortalMode.test.ts
// (TurretSystem) and FireControlProjectileRoute.test.ts (runtime transfer, bonus, flames, splits).

describe('Ausführbarer Fixture-Baustein: automatische Waffe → Projektil-Route', () => {
  it('Arrange: echte MG-Waffe mit zugewiesener Route; Act: über den automatischen Adapter feuern; Assert: Projektil entsteht am Ausgang mit Original-Attribution', () => {
    const f = createFireControlProjectileFixture();
    try {
      expect(f.weapons.fire(WEAPON_CONFIGS.TURRET_MG, { x: 0, y: 0, angle: 0,
        targetX: 600, targetY: 0, ownerId: 'inspector', ownerColor: 0xffffff,
        options: { sourceTurretId: '7', sourceSlot: 'utility', fireControlRoute: {
          contributionId: fireControlContributionId(1), ownerId: 'inspector',
          entry: { x: 0, y: 0 }, exit: { x: 500, y: 0 }, damageBonus: 0.5,
        } },
      })).toBe(true);
      expect(f.spawn).toHaveBeenCalled();
      for (const [request] of f.spawn.mock.calls) expect(request.provenance.sourceTurretId).toBe('7');
      expect(f.projectiles.activeCount).toBe(f.spawn.mock.calls.length);
      for (const handle of f.physics.handles.values()) expect(handle.sprite).toMatchObject({ x: 500, y: 0 });
    } finally { f.destroy(); }
  });
});

type Fixture = ReturnType<typeof createFireControlWorldFixture>;
let f: Fixture;
afterEach(() => f?.destroy());

/** Real throw → rest → payload → deployment; returns the opened portal snapshot. */
const openPortal = (at: number, x: number, y: number): FireControlPortalDeploymentSnapshot => {
  expect(f.throwPortal(at - 100).ok).toBe(true);
  const state = f.action.getFireControlState('inspector', 'FIRE_CONTROL_PORTAL');
  if (state?.phase !== 'flying') throw Error('flying');
  const handle = f.projectile.physics.handles.get(state.projectileId)!;
  handle.body.reset(x, y); handle.body.setVelocity(0, 0);
  const stage = f.projectile.advance(Math.max(16, at - f.projectile.now));
  f.action.createFireControlPortalFromGrenade(stage.grenadePayloads[0] as ProjectileGrenadePayloadRequest, at);
  return portalAt(at)!;
};
const portalAt = (at: number) => f.binding.getFireControlSnapshot(at).deployments
  .find((d): d is FireControlPortalDeploymentSnapshot => d.kind === 'portal');
const weaponSpawns = (from = 0) => f.projectile.spawn.mock.calls.slice(from).map(([request]) => request)
  .filter(request => request.provenance.sourceSlot === 'utility' && request.interaction.grenadeEffect === undefined);
const routed = (requests: readonly ProjectileSpawnRequest[]) => requests.filter(request => request.fireControlRoute);

describe('Ein Portal bleibt über mehrere Feuerzyklen offen; ein Turm trifft am Ausgang einen Gegner weit außerhalb seiner Standortreichweite', () => {
  it('transports every regular fire cycle to the fixed exit while the deployment stays open', () => {
    f = createFireControlWorldFixture();
    const p = f.point(f.add('machine_gun_turret'));
    const exit = { x: p.x + 1200, y: p.y };
    const enemy = f.spawnEnemy(exit.x + 60, exit.y);
    f.tick(1000);
    expect(weaponSpawns()).toEqual([]); // Out of the source's local range.
    const portal = openPortal(1100, exit.x, exit.y);
    expect(portal).toMatchObject({ x: exit.x, y: exit.y });
    for (const at of [1100, 2100, 3100, 4100]) {
      f.tick(at);
      expect(portalAt(at)?.id).toBe(portal.id);
    }
    const shots = routed(weaponSpawns());
    expect(shots.length).toBeGreaterThanOrEqual(3);
    for (const shot of shots) {
      expect(shot.fireControlRoute).toMatchObject({ contributionId: fireControlContributionId(portal.id),
        ownerId: 'inspector', exit });
      expect(shot.provenance.sourceTurretId).toBe(String(f.placement.getAllRuntimeRocks()[0].id));
    }
    // Every transported shot starts at the exit (the jump itself is free), none at the source.
    f.projectile.spawn.mock.calls.forEach(([request], index) => {
      if (!request.fireControlRoute) return;
      const sprite = f.projectile.physics.handles.get(f.projectile.spawn.mock.results[index].value as number)!.sprite;
      expect(Math.hypot(sprite.x - exit.x, sprite.y - exit.y)).toBeLessThan(20);
    });
    expect(portalAt(4100)!.entries[0]).toMatchObject({ mode: 'portal', lastTransportAt: 4100 });
    expect(enemy.sprite.active).toBe(true);
  });
});

describe('Ziele in verschiedenen Richtungen um den Ausgang führen zu passender Rohrdrehung und Austrittsrichtung; Eingang und Mündung bleiben zusammen', () => {
  it('turns towards exit → target and keeps the entry on the firing line in front of the muzzle', () => {
    f = createFireControlWorldFixture();
    const p = f.point(f.add('machine_gun_turret'));
    const exit = { x: p.x + 900, y: p.y + 300 };
    openPortal(1000, exit.x, exit.y);
    const east = f.spawnEnemy(exit.x + 80, exit.y);
    f.tick(1000);
    f.enemies.hostRemoveEnemy(east.id);
    const north = f.spawnEnemy(exit.x, exit.y - 80);
    const before = f.projectile.spawn.mock.calls.length;
    f.tick(2000);
    const first = routed(weaponSpawns())[0], last = routed(weaponSpawns(before)).at(-1)!;
    expect(first.origin.angle).toBeCloseTo(0, 1);
    expect(last.origin.angle).toBeCloseTo(-Math.PI / 2, 1);
    const entry = portalAt(2000)!.entries[0];
    expect(entry.angle).toBeCloseTo(last.origin.angle, 6);
    // Entry directly ahead of the real muzzle, on the shot's heading.
    const ahead = (entry.x - last.origin.x) * Math.cos(entry.angle) + (entry.y - last.origin.y) * Math.sin(entry.angle);
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThan(12);
    expect(north.sprite.active).toBe(true);
  });
});

describe('Spieler, Gegner, fremde und nicht zugeordnete Schüsse nutzen keinen Eingang; kein Rücktransport, kein Pingpong', () => {
  it('moves only shots that carry a route from their own spawn request', () => {
    f = createFireControlWorldFixture();
    const p = f.point(f.add('machine_gun_turret'));
    openPortal(1000, p.x + 900, p.y);
    f.tick(1000); // Entry pose reported; no exit target.
    const entry = portalAt(1000)!.entries[0];
    const before = f.projectile.spawn.mock.calls.length;
    // An unassigned own shot fired straight through the open entry stays local.
    expect(f.projectile.weapons.fire(WEAPON_CONFIGS.TURRET_MG, { x: entry.x - 4, y: entry.y, angle: 0,
      targetX: entry.x + 300, targetY: entry.y, ownerId: 'inspector', ownerColor: 0xffffff,
      options: { sourceSlot: 'utility' } })).toBe(true);
    const id = f.projectile.spawn.mock.results[before].value as number;
    f.projectile.advance(50);
    expect(Math.abs(f.projectile.physics.handles.get(id)!.sprite.x - (entry.x - 4))).toBeLessThan(200);
    expect(f.projectile.spawn.mock.calls[before][0].fireControlRoute).toBeUndefined();
  });
});

describe('Ohne Boss-Knoten bleibt eine Quelle ohne Ausgangsziel untätig; mit Boss-Knoten kämpft sie lokal und kehrt zurück; Salvenweg und Nachladezustand bleiben konsistent', () => {
  it('stays silent without the boss node although a local target is in range', () => {
    f = createFireControlWorldFixture();
    const p = f.point(f.add('machine_gun_turret'));
    f.spawnEnemy(p.x + 60, p.y);
    openPortal(1000, p.x + 1200, p.y);
    f.tick(1000); f.tick(2000);
    expect(weaponSpawns()).toEqual([]);
    expect(portalAt(2000)!.entries).toEqual([expect.objectContaining({ mode: 'waiting' })]);
  });

  it('fights locally with the boss node and returns to the portal once the exit has a target', () => {
    f = createFireControlWorldFixture({}, { localFireEnabled: 1 });
    const p = f.point(f.add('machine_gun_turret'));
    f.spawnEnemy(p.x + 60, p.y);
    const exit = { x: p.x + 1200, y: p.y };
    expect(openPortal(1000, exit.x, exit.y).localFireRelease).toBe(true);
    f.tick(1000);
    expect(weaponSpawns().length).toBeGreaterThan(0);
    expect(routed(weaponSpawns())).toEqual([]);
    expect(portalAt(1000)!.entries[0].mode).toBe('local');
    f.spawnEnemy(exit.x + 60, exit.y);
    const before = f.projectile.spawn.mock.calls.length;
    f.tick(2000);
    expect(portalAt(2000)!.entries[0].mode).toBe('portal');
    expect(weaponSpawns(before).length).toBeGreaterThan(0);
    expect(weaponSpawns(before).every(request => request.fireControlRoute)).toBe(true);
  });
});

describe('Beide Aktivierungsreihenfolgen funktionieren; neue Kopien erhalten Eingänge; pausierte Originale bleiben pausiert', () => {
  const entryIds = (at: number) => portalAt(at)!.entries.map(entry => entry.sourceId).sort();

  it.each([0, 1])('copies first, then portal (parallel %i)', parallelEnabled => {
    f = createFireControlWorldFixture({ parallelEnabled });
    const rock = f.add('machine_gun_turret');
    expect(f.place(1000, 100, 0).ok).toBe(true);
    const at = 1000 + f.config.materializeMs + 100;
    f.tick(at - 100);
    openPortal(at, 1500, 0);
    f.tick(at);
    // A paused original never takes part; the materialized copy does.
    const ids = entryIds(at);
    expect(ids.filter(id => isFireControlCopySourceId(id))).toHaveLength(1);
    expect(ids.includes(rock.id)).toBe(parallelEnabled === 1);
  });

  it.each([0, 1])('portal first, then copies (parallel %i)', parallelEnabled => {
    f = createFireControlWorldFixture({ parallelEnabled });
    const rock = f.add('machine_gun_turret');
    openPortal(1000, 1500, 0);
    f.tick(1000);
    expect(entryIds(1000)).toEqual([rock.id]);
    expect(f.place(1100, 100, 0).ok).toBe(true);
    f.tick(1101);
    expect(entryIds(1101)).toEqual(parallelEnabled ? [rock.id] : []);
    f.tick(1100 + f.config.materializeMs + 1);
    const ids = entryIds(1100 + f.config.materializeMs + 1);
    expect(ids.filter(id => isFireControlCopySourceId(id))).toHaveLength(1);
    expect(ids.includes(rock.id)).toBe(parallelEnabled === 1);
  });

  it('lets originals rejoin without a pause when the copies end before the portal', () => {
    f = createFireControlWorldFixture({ durationMs: 1000 });
    const rock = f.add('machine_gun_turret');
    expect(f.place(1000, 100, 0).ok).toBe(true);
    openPortal(1500, 1500, 0);
    f.tick(1500);
    expect(entryIds(1500).every(id => isFireControlCopySourceId(id))).toBe(true);
    f.tick(2000);
    expect(entryIds(2000)).toEqual([rock.id]);
  });
});

describe('Portalschaden wird je Einsatz einmal angewandt und erreicht Explosion, Brand und Flammen-Kinder ohne doppelte Skalierung; schadenfreie Kontrolle bleibt unverändert', () => {
  it('passes the frozen bonus once through the transfer context, never into the execution multipliers', () => {
    f = createFireControlWorldFixture({}, { damageBonus: 0.4 });
    const p = f.point(f.add('machine_gun_turret'));
    f.spawnEnemy(p.x + 60, p.y);
    f.tick(1000);
    const local = weaponSpawns()[0];
    for (const enemy of f.enemies.getAllEnemies()) f.enemies.hostRemoveEnemy(enemy.id);
    const exit = { x: p.x + 1200, y: p.y };
    const portal = openPortal(1500, exit.x, exit.y);
    f.spawnEnemy(exit.x + 60, exit.y);
    const before = f.projectile.spawn.mock.calls.length;
    f.tick(2000);
    const shot = routed(weaponSpawns(before))[0];
    expect(shot.fireControlRoute).toMatchObject({ contributionId: fireControlContributionId(portal.id), damageBonus: 0.4 });
    expect(shot.interaction.directHit).toEqual(local.interaction.directHit);
    expect(shot.provenance.portalDamage ?? []).toEqual(local.provenance.portalDamage ?? []);
  });
});

describe('Entfernen von Quellen, Einsatzende, Besitzerentfernung und World-Wechsel hinterlassen weder Portale noch Pausen; Clients und Late Join sehen den richtigen Zustand', () => {
  it('drops entries of removed sources, ends cleanly and replicates entries for late join', () => {
    f = createFireControlWorldFixture();
    const keep = f.add('machine_gun_turret'), lost = f.add('rocket_turret', 'inspector', 9);
    openPortal(1000, 1500, 0);
    f.tick(1000);
    expect(portalAt(1000)!.entries.map(e => e.sourceId).sort()).toEqual([keep.id, lost.id].sort());
    const snapshot = f.binding.getFireControlSnapshot(1000);
    const joined = decodeFireControlSnapshot(encodeFireControlSnapshot(snapshot))!.deployments[0];
    expect(joined).toMatchObject({ kind: 'portal', id: snapshot.deployments[0].id, expiresAt: snapshot.deployments[0].expiresAt });
    if (joined.kind !== 'portal') throw Error('portal');
    expect(joined.entries.map(e => [e.sourceId, e.mode])).toEqual(portalAt(1000)!.entries.map(e => [e.sourceId, e.mode]));
    f.placement.removeRock(lost.id); f.tick(1100);
    expect(portalAt(1100)!.entries.map(e => e.sourceId)).toEqual([keep.id]);
    const end = portalAt(1100)!.expiresAt;
    f.tick(end);
    expect(f.binding.getFireControlSnapshot(end).deployments).toEqual([]);
    expect(f.binding.getTurretFireSources().every(source => !source.portal && source.fireState === 'active')).toBe(true);
    openPortal(end + 1000 + f.portalConfig.cooldown, 1500, 0);
    f.binding.destroy();
    expect(f.binding.getFireControlSnapshot(end + 2000 + f.portalConfig.cooldown).deployments).toEqual([]);
  });
});
