import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
vi.mock('phaser', () => ({}));
vi.mock('../src/effects/enemyClaw/EnemyClawGpuLayer', () => ({
  ClawVfxPass: { Ground: 0, Top: 1 },
  createEnemyClawGpuLayer: () => null,
}));
import { EnemyClawRenderer } from '../src/effects/EnemyClawRenderer';
import {
  CLAW_VFX_CAPACITY, CLAW_VFX_INSTANCE_FLOATS, CLAW_VFX_SLASH_MS, EnemyClawVfxStore,
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
});

describe('enemy claw instance store', () => {
  const spec = (x: number) => ({ x, y: 0, angle: 0.5, range: 50, halfArc: 0.7,
    startedAt: 0, strikeAt: 270, hitAt: 350, color: 0xff0000 });

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
