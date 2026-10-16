import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
vi.mock('phaser', () => ({}));
vi.mock('../src/effects/enemyClaw/EnemyClawGpuLayer', () => ({
  ClawVfxPass: { Ground: 0, Top: 1 },
  createEnemyClawGpuLayer: () => null,
}));
import { EnemyClawRenderer } from '../src/effects/EnemyClawRenderer';
import type { EnemyAreaClawEvent } from '../src/systems/EnemyClawAttack';
import {
  CLAW_VFX_CAPACITY, CLAW_VFX_INSTANCE_FLOATS, CLAW_VFX_SLASH_MS, EnemyClawVfxStore,
  CLAW_VFX_FLOATS_PER_VERTEX, CLAW_VFX_TELEGRAPH_FADE_MS, ClawVfxKind,
} from '../src/effects/enemyClaw/EnemyClawVfxStore';

describe('enemy claw presentation lifetime', () => {
  function fixture() {
    const scene = { time: { now: 0 } };
    const renderer = new EnemyClawRenderer(scene as unknown as Phaser.Scene);
    const store = (renderer as unknown as { store: EnemyClawVfxStore }).store;
    const attack = { attackId: 'e:1', weaponId: 'bite', angle: 0, range: 40, arcDegrees: 100,
      startedAt: 1000, strikeAt: 1270, hitAt: 1350, endsAt: 1570 };
    const state = { revision: 1, attack };
    const swing = { swingId: 1, shooterId: 'e', x: 100, y: 100, color: 0, angle: 0,
      arcDegrees: 100, range: 40, clawAttackId: attack.attackId };
    return { scene, renderer, store, attack, state, swing };
  }

  it('plays one rake from the windup timeline and adds the confirmed contact once', () => {
    const f = fixture();
    f.renderer.sync('e', f.state, 100, 100, 1000, true);
    expect(f.store.count).toBe(1);
    f.scene.time.now = 350;
    f.renderer.sync('e', f.state, 100, 100, 1350, true);
    const confirmed = { ...f.swing, hitPlayer: true, impactX: 120, impactY: 100 };
    f.renderer.confirm(confirmed);
    f.renderer.confirm(confirmed);
    expect(f.store.count).toBe(2);
    // Recovery ends the windup, but the running rake and contact finish on their own.
    f.renderer.sync('e', { revision: 2, attack: null }, 100, 100, 1400, true);
    expect(f.store.count).toBe(2);
    f.scene.time.now = 350 + CLAW_VFX_SLASH_MS + 400;
    f.renderer.sync('e', { revision: 2, attack: null }, 100, 100, 2000, true);
    expect(f.store.count).toBe(0);
  });

  it('removes a windup cancelled before its hit and never replays a strike first seen late', () => {
    const f = fixture();
    f.renderer.sync('e', f.state, 100, 100, 1000, true);
    f.renderer.release('e');
    expect(f.store.count).toBe(0);
    f.renderer.sync('late', { ...f.state, attack: { ...f.attack, attackId: 'e:2' } }, 100, 100, 1400, true);
    f.renderer.confirm({ ...f.swing, clawAttackId: 'e:2' });
    expect(f.store.count).toBe(0);
  });

  it('plays an unseen authoritative strike from the host result and clears everything', () => {
    const f = fixture();
    f.renderer.confirm(f.swing);
    expect(f.store.count).toBe(1);
    f.renderer.clear();
    expect(f.store.count).toBe(0);
  });

  it('draws a tongue windup as a rake-free sector warning', () => {
    const f = fixture();
    f.renderer.sync('e', f.state, 100, 100, 1000, true, undefined, true);
    expect(f.store.data[10]).toBe(ClawVfxKind.TelegraphSector);
  });

  it('announces an armed landing as a round, rake-free zone and releases it', () => {
    const f = fixture();
    const zone = { attackId: 'hop:e:1', x: 300, y: 200, radius: 46, startedAt: 1000, strikeAt: 1480, hitAt: 1600, endsAt: 1680 };
    f.renderer.syncZone('hop', zone, 1000, true);
    f.renderer.syncZone('hop', zone, 1100, true);
    expect(f.store.count).toBe(1);
    expect(f.store.data[10]).toBe(ClawVfxKind.TelegraphSector);
    f.renderer.syncZone('hop', null, 1200, true);
    expect(f.store.count).toBe(0);
    f.renderer.syncZone('late', { ...zone, attackId: 'hop:e:2' }, 1650, true);
    expect(f.store.count).toBe(0);
  });
});

describe('enemy claw instance store', () => {
  const spec = (x: number) => ({ x, y: 0, angle: 0.5, range: 50, halfArc: 0.7,
    startedAt: 0, strikeAt: 270, hitAt: 350, color: 0xff0000 });

  it('opts into a sector warning without claw rakes, preserving regular sectors', () => {
    const store = new EnemyClawVfxStore();
    store.addAttack('soft', spec(10), 0);
    store.addAttack('telegraphOnly', { ...spec(10), telegraphOnly: true }, 0);
    expect(store.data[10]).toBe(ClawVfxKind.Attack);
    expect(store.data[CLAW_VFX_INSTANCE_FLOATS + 10]).toBe(ClawVfxKind.TelegraphSector);
    expect(store.data[8]).toBe(store.data[CLAW_VFX_INSTANCE_FLOATS + 8]);
    store.retire(350 + CLAW_VFX_SLASH_MS);
    expect(store.count).toBe(0);
  });

  it('rotates a lane about its entry, preserves its full width, and retires after the telegraph fade', () => {
    const store = new EnemyClawVfxStore();
    const lane = { shape: 'lane' as const, x: 70, y: 80, angle: Math.PI / 2, length: 240, width: 96,
      startedAt: 0, strikeAt: 270, hitAt: 350, color: 0xff0000 };
    store.addAttack('lane', lane, 0);
    const localX: number[] = [], localY: number[] = [];
    for (let v = 0; v < 6; v++) {
      const o = v * CLAW_VFX_FLOATS_PER_VERTEX;
      localX.push(store.data[o + 2]); localY.push(store.data[o + 3]);
      expect(store.data[o]).toBeCloseTo(lane.x - store.data[o + 3]);
      expect(store.data[o + 1]).toBeCloseTo(lane.y + store.data[o + 2]);
      expect(store.data[o + 8]).toBe(lane.length);
      expect(store.data[o + 9] * 2).toBe(lane.width);
      expect(store.data[o + 10]).toBe(ClawVfxKind.Lane);
    }
    expect(Math.min(...localX)).toBeLessThanOrEqual(0);
    expect(Math.max(...localX)).toBeGreaterThanOrEqual(lane.length);
    expect(Math.min(...localY)).toBeLessThanOrEqual(-lane.width / 2);
    expect(Math.max(...localY)).toBeGreaterThanOrEqual(lane.width / 2);
    store.move('lane', 90, 100);
    expect(store.data[0]).toBeCloseTo(90 - store.data[3]);
    store.retire(lane.hitAt);
    expect(store.has('lane')).toBe(true);
    store.retire(lane.hitAt + CLAW_VFX_TELEGRAPH_FADE_MS);
    expect(store.count).toBe(0);
  });

  it('keeps the existing implicit sector equivalent to an explicit sector beside a lane', () => {
    const implicit = new EnemyClawVfxStore(), explicit = new EnemyClawVfxStore();
    implicit.addAttack('sector', spec(10), 0);
    explicit.addAttack('sector', { ...spec(10), shape: 'sector' }, 0);
    expect(explicit.data).toEqual(implicit.data);
  });

  it('keeps keys addressable across swap-removal and re-anchors vertices', () => {
    const store = new EnemyClawVfxStore();
    store.addAttack('a', spec(0), 0);
    store.addAttack('b', spec(10), 0);
    store.remove('a');
    expect(store.count).toBe(1);
    expect(store.colorOf('b')).toBe(0xff0000);
    const before = store.data[0];
    store.move('b', 20, 0);
    expect(store.data[0] - before).toBeCloseTo(10, 4);
    // Removed instance data never stays in the uploaded live range.
    expect(store.has('a')).toBe(false);
    expect(store.data.subarray(0, store.count * CLAW_VFX_INSTANCE_FLOATS).length).toBe(CLAW_VFX_INSTANCE_FLOATS);
  });

  it('stays within its fixed capacity and rebases its clock only while empty', () => {
    const store = new EnemyClawVfxStore();
    for (let i = 0; i <= CLAW_VFX_CAPACITY; i++) store.addAttack(`k${i}`, spec(i), 0);
    expect(store.count).toBe(CLAW_VFX_CAPACITY);
    store.retire(10_000);
    expect(store.count).toBe(0);
    expect(store.time(5_000_000)).toBe(0);
  });
});

describe('canonical area claw projection', () => {
  const event = (partId: string): EnemyAreaClawEvent => ({ worldRevision: 1, activityRevision: 2,
    enemyId: 'kraken', entityGeneration: 3, slot: { kind: 'part', partId, partGeneration: 1, cycleId: 2 },
    state: { revision: 1, attack: { attackId: 'slam', weaponId: 'tentacle', presentation: 'tentacle',
      pose: { originX: 75, originY: 30, angle: Math.PI / 2, geometry: { kind: 'lane', length: 240, width: 80 } },
      startedAt: 1000, strikeAt: 1500, hitAt: 1700, endsAt: 1900 } } });
  function fixture() {
    const scene = { time: { now: 0 } };
    const renderer = new EnemyClawRenderer(scene as never);
    return { scene, renderer, store: (renderer as unknown as { store: EnemyClawVfxStore }).store };
  }
  it('keeps simultaneous lanes independent and rejects stale baselines after cancellation', () => {
    const { renderer, store } = fixture(), left = event('left'), right = event('right');
    renderer.syncArea(left, 1100); renderer.syncArea(right, 1100);
    expect(store.count).toBe(2);
    expect(store.data[10]).toBe(ClawVfxKind.Lane);
    const before = store.data.slice();
    renderer.syncArea({ ...left, state: { ...left.state, attack: { ...left.state.attack!,
      pose: { ...left.state.attack!.pose, originX: 999 } } } }, 1200);
    expect(store.data).toEqual(before); // the warning cannot chase a moving target
    renderer.syncArea({ ...left, state: { revision: 2, attack: null } }, 1200);
    renderer.syncArea(left, 1200);
    expect(store.count).toBe(1);
    renderer.releaseArea(right);
    expect(store.count).toBe(0);
    renderer.syncArea(right, 1200);
    expect(store.count).toBe(0);
  });
  it.each(['ink', 'tentacle', 'slam'] as const)('%s confirmation never draws claw scratches or replays a cancelled part', presentation => {
    const { renderer, store } = fixture();
    const e = event('a'), a = { ...e.state.attack!, presentation };
    if (presentation === 'ink') a.pose = { ...a.pose, geometry: { kind: 'sector', range: 300, arcDegrees: 60 } };
    if (presentation !== 'tentacle') e.slot = { kind: 'body' };
    e.state.attack = a;
    renderer.syncArea(e, 1100);
    const kind = presentation === 'ink' ? ClawVfxKind.TelegraphSector : ClawVfxKind.Lane;
    expect(store.data[10]).toBe(kind);
    const swing = { swingId: 1, shooterId: 'kraken', x: -999, y: -999, angle: 0, range: 1, arcDegrees: 1,
      color: 0, hitPlayer: true, impactX: 10, impactY: 20, areaClaw: { ...e, state: undefined, revision: 1, attack: a } };
    renderer.confirm(swing); renderer.confirm(swing);
    expect(store.count).toBe(1);
    renderer.releaseArea(e); renderer.confirm(swing);
    expect(store.count).toBe(0);
  });
  it('uses canonical sector geometry even when the legacy confirmation fields disagree', () => {
    const { renderer, store } = fixture(), e = event('a');
    e.slot = { kind: 'body' };
    const a = { ...e.state.attack!, presentation: 'claw' as const,
      pose: { originX: 90, originY: 60, angle: 0, geometry: { kind: 'sector' as const, range: 120, arcDegrees: 70 } } };
    renderer.confirm({ swingId: 1, shooterId: 'k', x: -1, y: -1, angle: 0, range: 1, arcDegrees: 1, color: 0,
      areaClaw: { ...e, revision: 1, attack: a } });
    expect(store.data[8]).toBe(a.pose.geometry.range);
    expect(store.data[0] - store.data[2]).toBeCloseTo(a.pose.originX, 4);
    expect(store.data[10]).toBe(ClawVfxKind.Attack);
  });
});
