import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
vi.mock('phaser', () => ({}));
vi.mock('../src/effects/EffectUtils', () => ({ ensureCanvasTexture: vi.fn() }));
vi.mock('../src/effects/gpu/GpuVfxSourceTextures', () => ({
  ensureExplosionSmokeTexture: vi.fn(), TEX_EXPLOSION_SMOKE: 'shared-smoke',
}));
vi.mock('../src/ui/HostileBaseIndicator', () => ({ getVisibleWorldView: () => ({ x: 0, y: 0, width: 400, height: 400 }) }));
import { buildWatchtowerDestructionPlan } from '../src/effects/watchtower/WatchtowerDestructionPlan';
import { WatchtowerDestructionFx } from '../src/effects/watchtower/WatchtowerDestructionFx';

describe('watchtower collapse presentation', () => {
  it('scales and translates a bounded plan with debris preceding the ground impact', () => {
    const plan = buildWatchtowerDestructionPlan(0, 0, 64, 64);
    const scaled = buildWatchtowerDestructionPlan(300, 400, 128, 128);
    expect(scaled).toHaveLength(plan.length);
    expect(new Set(plan.map(p => p.material))).toEqual(new Set(['plank', 'splinter', 'iron', 'dust', 'impact']));
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i], s = scaled[i];
      expect(s.x).toBeCloseTo(300 + p.x * 2); expect(s.endY).toBeCloseTo(400 + p.endY * 2);
      expect(p.delayMs).toBeGreaterThanOrEqual(0); expect(p.lifeMs).toBeGreaterThan(p.flightMs);
    }
    expect(Math.max(...plan.filter(p => p.material === 'plank').map(p => p.delayMs)))
      .toBeLessThan(plan.find(p => p.material === 'impact')!.delayMs);
    expect(buildWatchtowerDestructionPlan(0, 0, 0, 64)).toEqual([]);
    expect(buildWatchtowerDestructionPlan(NaN, 0, 64, 64)).toEqual([]);
  });

  it('bounds bursts, reuses images and cancels every pending piece on clear/destroy', () => {
    const events = new EventEmitter();
    // Phaser EventEmitter supports callback contexts; emulate that semantic port.
    const listeners = new Map<Function, (...args: number[]) => void>();
    const sceneEvents = {
      on(name: string, fn: Function, context: unknown) { const cb=fn.bind(context); listeners.set(fn,cb); events.on(name,cb); },
      once(name: string, fn: Function, context: unknown) { const cb=fn.bind(context); listeners.set(fn,cb); events.once(name,cb); },
      off(name: string, fn: Function) { events.off(name,listeners.get(fn)!); },
    };
    const images: any[] = [];
    const scene = { events: sceneEvents, cameras: { main: {} }, textures: { remove: vi.fn() }, add: { image() {
      const image: any = { visible: false, destroy: vi.fn() };
      for (const method of ['setActive','setDepth','setTexture','setPosition','setRotation','setDisplaySize','setTint','setAlpha']) image[method]=()=>image;
      image.setVisible=(value:boolean)=>{image.visible=value;return image;};
      images.push(image); return image;
    } } };
    const fx = new WatchtowerDestructionFx(scene as never), allocated = images.length;
    expect(fx.play(10000,10000,64)).toBe(false);
    let bursts=0;
    while(fx.play(100,100,64)) { bursts++; expect(bursts).toBeLessThan(100); }
    expect(bursts).toBeGreaterThan(0);
    events.emit('postupdate',0,200); expect(images.some(image=>image.visible)).toBe(true);
    fx.clear(); events.emit('postupdate',0,200); expect(images.every(image=>!image.visible)).toBe(true);
    expect(fx.play(100,100,64)).toBe(true);
    const end=Math.max(...buildWatchtowerDestructionPlan(0,0,64,64).map(p=>p.delayMs+p.lifeMs));
    events.emit('postupdate',0,end+1); expect(images.every(image=>!image.visible)).toBe(true);
    expect(images).toHaveLength(allocated);
    events.emit('shutdown'); fx.destroy();
    expect(images.every(image=>image.destroy.mock.calls.length===1)).toBe(true);
    expect(events.listenerCount('postupdate')).toBe(0);
    expect(fx.play(100,100,64)).toBe(false);
    expect(scene.textures.remove.mock.calls.flat()).not.toContain('shared-smoke');
  });
});
