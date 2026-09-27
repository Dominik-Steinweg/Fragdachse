import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
vi.mock('phaser', () => ({ Math: { RadToDeg: (n: number) => n * 180 / Math.PI,
  Vector2: class { constructor(public x: number, public y: number) {} } } }));
vi.mock('../src/effects/EffectUtils', () => ({
  createEmitter: (scene: any) => scene.add.particles(), ensureCanvasTexture: () => {},
  registerGraphicsObject: () => {}, killAllAndResetParticlePositions: (emitter: any) => emitter.killAll(),
}));
import { EnemyClawRenderer } from '../src/effects/EnemyClawRenderer';

describe('enemy claw presentation lifetime', () => {
  function fixture() {
    const allocated: any[] = [], emitters: any[] = [], tweens: any[] = [];
    const scene = { time: { now: 0 }, textures: {}, add: {
      graphics() {
        const graphic: any = {};
        for (const method of ['clear', 'setDepth', 'setVisible', 'fillStyle', 'fillPoints', 'lineStyle',
          'strokePoints', 'lineBetween', 'setPosition', 'setRotation', 'setAlpha', 'destroy']) graphic[method] = vi.fn(() => graphic);
        allocated.push(graphic); return graphic;
      },
      particles() {
        const emitter = { setEmitterAngle: vi.fn(), explode: vi.fn(), killAll: vi.fn(), destroy: vi.fn() };
        emitters.push(emitter); return emitter;
      },
    }, tweens: { add: (t: any) => tweens.push(t), killTweensOf: vi.fn() } };
    const renderer = new EnemyClawRenderer(scene as unknown as Phaser.Scene);
    const attack = { attackId: 'e:1', weaponId: 'bite', angle: 0, range: 40, arcDegrees: 100,
      startedAt: 1000, strikeAt: 1270, hitAt: 1350, endsAt: 1570 };
    const state = { revision: 1, attack };
    const swing = { swingId: 1, shooterId: 'e', x: 100, y: 100, color: 0, angle: 0,
      arcDegrees: 100, range: 40, clawAttackId: attack.attackId };
    return { scene, renderer, attack, state, swing, allocated, emitters, tweens };
  }

  it('keeps anticipation visible, emits no speculative blood, and deduplicates confirmed contact', () => {
    const f = fixture();
    f.renderer.sync('e', f.state, 100, 100, 1000, true);
    expect(f.allocated[0].setVisible).toHaveBeenLastCalledWith(true);
    expect(f.emitters).toHaveLength(0);
    f.renderer.sync('e', f.state, 100, 100, 1350, true);
    expect(f.tweens).toHaveLength(1);
    expect(f.emitters[1].explode).not.toHaveBeenCalled();
    const confirmed = { ...f.swing, hitPlayer: true, impactX: 120, impactY: 100 };
    f.renderer.confirm(confirmed);
    f.scene.time.now += 10000; f.renderer.confirm(confirmed);
    expect(f.tweens).toHaveLength(1);
    expect(f.emitters[1].explode).toHaveBeenCalledTimes(1);
    f.renderer.clear();
    expect(f.emitters.every(e => e.killAll.mock.calls.length > 0)).toBe(true);
    f.renderer.destroy();
    expect(f.allocated.every(g => g.destroy.mock.calls.length > 0)).toBe(true);
  });

  it('joins recovery without replaying a strike and returns cleared telegraphs to the pool', () => {
    const f = fixture();
    f.renderer.sync('e', f.state, 100, 100, 1400, true);
    f.renderer.confirm(f.swing);
    expect(f.tweens).toHaveLength(0);
    f.renderer.sync('e', { revision: 2, attack: null }, 100, 100, 1401, true);
    f.renderer.sync('next', { ...f.state, attack: { ...f.attack, attackId: 'e:2' } }, 100, 100, 1000, true);
    expect(f.allocated).toHaveLength(1);
    f.renderer.destroy();
  });
});
