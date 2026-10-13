import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireControlWorldFixture } from '../FireControlTestHelper';
import { resolveMgTurretStats } from '../../src/config/mgTurret';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';

let f: ReturnType<typeof createFireControlWorldFixture>;
afterEach(() => { f?.destroy(); vi.restoreAllMocks(); });
function setup(parallelEnabled = 1) {
  f = createFireControlWorldFixture({ parallelEnabled });
  const rock = f.add(); const enemy = f.spawnEnemy();
  expect(f.place(1000, 100).ok).toBe(true);
  f.tick(1000 + f.config.materializeMs);
  return { rock, enemy };
}

describe('real copy activation and original combat identity', () => {
  it('routes original and copy shots into the same confirmed MG stack and cap, preserving attribution after removal', () => {
    const { rock, enemy } = setup();
    const requests = f.projectile.spawn.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map(r => r.origin.x)).size).toBe(2);
    for (const request of requests) expect(request.provenance).toMatchObject({ sourceTurretId: String(rock.id), personalMgOwnerId: 'inspector' });
    const stats = resolveMgTurretStats(key => f.stats.get(key) ?? 0);
    const count = Math.ceil(stats.maximumPercent / stats.perHitPercent) + 2;
    for (let n = 0; n < count; n++) expect(f.hit(enemy, requests[n % 2]).actualDamage).toBeGreaterThan(0);
    expect(f.binding.mgTurret!.score('inspector', String(rock.id), 'enemy', enemy.id, 1400)).toBe(stats.maximumPercent);
    expect(f.binding.mgTurret!.score('inspector', 'fc-copy:1:0', 'enemy', enemy.id, 1400)).toBe(0);
    f.binding.fireControl!.clear(); f.placement.removeRock(rock.id);
    const killed = f.hit(enemy, requests[1], 200000);
    expect(killed.becameDead).toBe(true);
    expect(requests[1].provenance.sourceTurretId).toBe(String(rock.id));
  });

  it.each([false, true])('injector damage follows only the original location (buff at copy=%s)', atCopy => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    f = createFireControlWorldFixture({ parallelEnabled: 1 }); const rock = f.add(); f.spawnEnemy();
    const position = atCopy ? { x: 100 + f.config.singleCopyOffsetPx, y: 0 } : f.point(rock);
    const effect = COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret.energyInjectorEffect!;
    if (effect.type !== 'damage_turret') throw Error('damage turret');
    f.injector.applyConstructionEffect(String(rock.id), 'inspector', position.x, position.y,
      effect, { durationMs: f.config.durationMs, focusDurationMs: 0, vulnerabilityBonus: 0, color: 1 }, 1000);
    expect(f.place(1000, 100).ok).toBe(true); f.tick(1000 + f.config.materializeMs);
    const requests = f.projectile.spawn.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    const stats = resolveMgTurretStats();
    for (const request of requests) expect(request.interaction?.directHit?.damage)
      .toBeCloseTo(stats.damage * (atCopy ? 1 : effect.damageMultiplier));
  });

  it('remote control selects a real construction and the copy inherits its single bonus', () => {
    f = createFireControlWorldFixture(); const rock = f.add(); f.spawnEnemy(); f.setRemoteBonus(.5);
    expect(f.place(1000, 100).ok).toBe(true); f.tick(1000 + f.config.materializeMs);
    const sources = f.binding.getOffensiveConstructionSources();
    expect(sources.map(s => s.id)).toEqual([rock.id]);
    expect(f.item.getRemoteControlTarget('inspector', sources)?.id).toBe(rock.id);
    expect(f.projectile.spawn.mock.calls[0][0].interaction?.directHit?.damage).toBeCloseTo(resolveMgTurretStats().damage * 1.5);
  });

  it('keeps live turret stats and separate original identities for multiple copies', () => {
    f = createFireControlWorldFixture({ maxCopies: 2, parallelEnabled: 1 });
    const first = f.add(), second = f.add('machine_gun_turret', 'inspector', 9), enemy = f.spawnEnemy();
    expect(f.place(1000, 100).ok).toBe(true); f.tick(1000 + f.config.materializeMs);
    const requests = f.projectile.spawn.mock.calls.map(([r]) => r);
    const firstShot = requests.find(r => r.provenance.sourceTurretId === String(first.id))!;
    expect(firstShot).toBeDefined(); f.hit(enemy, firstShot);
    expect(f.binding.mgTurret!.score('inspector', String(first.id), 'enemy', enemy.id, 1400)).toBeGreaterThan(0);
    expect(f.binding.mgTurret!.score('inspector', String(second.id), 'enemy', enemy.id, 1400)).toBe(0);
    f.placement.getRuntimeRock(first.id)!.turretWeaponId = 'SPORES';
    expect(f.binding.getTurretFireSources().filter(s => s.identityId === first.id).map(s => s.weaponId)).toEqual(['SPORES', 'SPORES']);
  });

  it('uses the owner injector focus for both sources', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    f = createFireControlWorldFixture({ parallelEnabled: 1 }); f.add();
    const focus = f.spawnEnemy(160, 60); f.spawnEnemy(140, 30);
    f.injector.setFocusTarget('inspector', { targetType: 'enemy', targetId: focus.id }, 10000, 1000);
    expect(f.place(1000, 100).ok).toBe(true); f.tick(1000 + f.config.materializeMs);
    const requests = f.projectile.spawn.mock.calls.map(([r]) => r);
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(request.origin.angle).toBeCloseTo(Math.atan2(focus.sprite.y - request.origin.y, focus.sprite.x - request.origin.x));
  });

  it('GDD 13: live original range upgrades reach both sources without restarting the deployment', () => {
    f = createFireControlWorldFixture({ parallelEnabled: 1 });
    const rock = f.add('rocket_turret');
    expect(f.place(1000, 100).ok).toBe(true);
    const before = f.binding.getFireControlSnapshot(1000);
    const runtimeRock = f.placement.getRuntimeRock(rock.id)!;
    // Synthetic upgrade input; parity with the live original is the invariant, not a balance value.
    runtimeRock.targetRange = WEAPON_CONFIGS.TURRET_ROCKET_BURST.range * 1.5;
    const original = f.binding.getTurretDefinitions().find(t => t.id === rock.id)!;
    const sources = f.binding.getTurretFireSources().filter(s => s.identityId === rock.id);
    expect(sources).toHaveLength(2);
    for (const source of sources) expect(source.targetRange).toBe(original.targetRange);
    expect(original.targetRange).toBe(runtimeRock.targetRange);
    expect(f.binding.getFireControlSnapshot(1000)).toEqual(before);
  });
});

it('GDD 13: parallel original and flame copy fire locally from separate origins with original attribution', () => {
  f = createFireControlWorldFixture({ parallelEnabled: 1 });
  const rock = f.add('flame_turret'), original = f.point(rock);
  f.spawnEnemy((original.x + 100 + f.config.singleCopyOffsetPx) / 2, original.y / 2);
  expect(f.place(1000, 100).ok).toBe(true);
  f.tick(1000 + f.config.materializeMs);
  const shots = f.projectile.spawn.mock.calls.map(([request]) => request).filter(r => r.flight.isFlame);
  expect(shots.some(r => r.origin.x === original.x && r.origin.y === original.y)).toBe(true);
  expect(shots.some(r => r.origin.x === 100 + f.config.singleCopyOffsetPx && r.origin.y === 0)).toBe(true);
  for (const shot of shots) expect(shot.provenance.sourceTurretId).toBe(String(rock.id));
});

// Remaining presentation/stream replication is P1.3; portal transport is M2.
  it.todo('Arrange: pausiertes Original und schießende Kopie mit eigener visualId; Act: Projektil-Snapshot an die Darstellung übergeben; Assert: turretVisualId löst nur die Kopienanimation aus und das pausierte Original animiert keinen Schuss');
  it.todo('P1.3/M2: Original und parallele Flammenkopie durch Portale feuern und replizieren; flameStreamKey bleibt je Quelle getrennt und Attribution beim Original');

  // The host turret execution does not yet consume spatial amplification fields (distinct from injector identity).
  it.todo('GDD 13: örtliches Verstärkungsfeld nur am Original oder Projektionsort; jeder Schuss erhält ausschließlich das Feld seiner tatsächlich feuernden Quelle');
  it.todo('Arrange: Verstärkungsfeld ausschließlich am Portalausgang; Act: entfernte Originalquelle und Kopie durch das Portal feuern lassen; Assert: Ausgangsfeld verstärkt keine der beiden Quellen');
