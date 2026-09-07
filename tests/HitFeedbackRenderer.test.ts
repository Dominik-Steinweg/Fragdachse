import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HIT_FEEDBACK_TIMING } from '../src/effects/hitFeedbackModel';
import type { SyncedHitEffect } from '../src/types';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0 }, TintModes: { FILL: 1 } }));
const quality = vi.hoisted(() => ({ hitFlash: true, entityJolt: true, hitFlashPoolSize: 2 }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => quality }));
import { HitFeedbackRenderer } from '../src/effects/HitFeedbackRenderer';

class Image {
  active = true; visible = true; alpha = 1; x = 0; y = 0; rotation = 0;
  originX = 0.5; originY = 0.5; flipX = false; flipY = false; depth = 5;
  displayWidth = 80; displayHeight = 100; tint = 0x123456; tintMode = -1; blendMode = -1;
  texture = { key: 'enemy' }; frame = { name: 'idle' }; destroyed = false;
  setActive(v: boolean) { this.active = v; return this; }
  setVisible(v: boolean) { this.visible = v; return this; }
  setAlpha(v: number) { this.alpha = v; return this; }
  setBlendMode(v: number) { this.blendMode = v; return this; }
  setTintMode(v: number) { this.tintMode = v; return this; }
  setTint(v: number) { this.tint = v; return this; }
  setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; }
  setFlip(x: boolean, y: boolean) { this.flipX = x; this.flipY = y; return this; }
  setDepth(v: number) { this.depth = v; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setRotation(v: number) { this.rotation = v; return this; }
  setDisplaySize(w: number, h: number) { this.displayWidth = w; this.displayHeight = h; return this; }
  setTexture(key: string, frame: string) { this.texture.key = key; this.frame.name = frame; return this; }
  destroy() { this.destroyed = true; this.active = false; }
}

function setup() {
  const images: Image[] = [];
  const targets = new Map<string, Image>();
  const jolt = { jolt: vi.fn(), getOffset: () => ({ x: 3, y: -2 }) };
  const scene = { add: { image: () => { const image = new Image(); images.push(image); return image; } } };
  const renderer = new HitFeedbackRenderer(scene as never, jolt as never);
  renderer.generateTextures();
  renderer.setSilhouetteProvider((id) => {
    const sprite = targets.get(id);
    return sprite ? { sprite: sprite as never, materialColor: sprite.tint, knockbackFactor: 1, isLocalPlayer: false } : null;
  });
  const add = (id: string) => { const target = new Image(); targets.set(id, target); return target; };
  const play = (id = 'enemy', damage = 8, isCritical = false) => renderer.playHit({
    type: 'hit', targetId: id, totalDamage: damage, hpLost: damage, armorLost: 0,
    isCritical, isKill: false, dirX: 1, dirY: 0, x: 0, y: 0, seed: 1,
  } satisfies SyncedHitEffect);
  const lit = () => images.filter((image) => image.active && image.visible && image.alpha > 0);
  return { renderer, images, targets, jolt, add, play, lit };
}

beforeEach(() => { quality.hitFlash = true; quality.entityJolt = true; });

describe('HitFeedbackRenderer', () => {
  it('fills the existing silhouette at peak and follows all target transforms without changing tint', () => {
    const s = setup();
    const target = s.add('enemy');
    s.play();
    const flash = s.lit()[0];
    expect(flash.blendMode).toBe(0);
    expect(flash.tintMode).toBe(1);
    expect(flash.alpha).toBeGreaterThan(0.5);
    const initialScale = flash.displayWidth / target.displayWidth;
    expect(initialScale).toBeGreaterThan(1);
    target.x = 20; target.y = 40; target.rotation = 1;
    target.originX = 0.2; target.originY = 0.8; target.flipX = true; target.flipY = true;
    target.displayWidth = 100; target.displayHeight = 120; target.depth = 10;
    target.texture.key = 'new-enemy'; target.frame.name = 'hurt';
    s.renderer.update(100);
    expect(flash.x).toBe(23); expect(flash.y).toBe(38);
    expect(flash.rotation).toBe(target.rotation);
    expect(flash.originX).toBe(target.originX); expect(flash.originY).toBe(target.originY);
    expect(flash.flipX && flash.flipY).toBe(true);
    expect(flash.texture.key).toBe(target.texture.key); expect(flash.frame.name).toBe(target.frame.name);
    expect(flash.depth).toBeGreaterThan(target.depth);
    expect(flash.displayWidth / target.displayWidth).toBeLessThan(initialScale);
    expect(flash.displayHeight / target.displayHeight).toBeCloseTo(flash.displayWidth / target.displayWidth);
    expect(target.tint).toBe(0x123456);
    target.visible = false;
    s.renderer.update(1);
    expect(s.lit()).toHaveLength(0);
  });

  it.each([10, 50, 60, 80])('has bounded pulses and darkness under a %i ms hit stream', (interval) => {
    const s = setup(); s.add('enemy');
    let continuous = 0; let dark = 0; let seenLight = false; let completedDark = false;
    for (let time = 0; time < 2000; time += 5) {
      // Alternating crits and progressively stronger hits must not evade the cap.
      if (time % interval === 0) s.play('enemy', 8 + time / 100, time % (interval * 2) === 0);
      expect(s.lit().length).toBeLessThanOrEqual(1);
      if (s.lit().length) {
        if (dark > 0 && seenLight) { expect(dark).toBeGreaterThanOrEqual(HIT_FEEDBACK_TIMING.darkMs); completedDark = true; }
        dark = 0; seenLight = true; continuous += 5;
        expect(continuous).toBeLessThanOrEqual(HIT_FEEDBACK_TIMING.maxRearmLifetimeMs + 5);
      } else { continuous = 0; dark += 5; }
      s.renderer.update(5);
    }
    expect(completedDark).toBe(true);
    expect(s.images).toHaveLength(quality.hitFlashPoolSize);
  });

  it('does not let flash suppression suppress jolt or existing camera feedback', () => {
    const s = setup(); s.add('enemy');
    const camera = { request: vi.fn() };
    s.renderer.setCameraFeedback(camera as never);
    s.renderer.setLocalPlayerIdProvider(() => 'enemy');
    s.play('enemy', 100);
    s.renderer.update(HIT_FEEDBACK_TIMING.maxRearmLifetimeMs);
    expect(s.lit()).toHaveLength(0);
    s.play('enemy', 100);
    expect(s.lit()).toHaveLength(0);
    expect(s.jolt.jolt).toHaveBeenCalledTimes(2);
    expect(camera.request).toHaveBeenCalledTimes(2);
    quality.hitFlash = false;
    s.play('enemy', 100);
    expect(s.jolt.jolt).toHaveBeenCalledTimes(3);
  });

  it.each([30, 60])('keeps an isolated hit readable over several frames at %i fps', (fps) => {
    const s = setup(); s.add('enemy'); s.play('enemy', 100);
    const peak = s.lit()[0].alpha;
    for (let frame = 0; frame < 3; frame++) s.renderer.update(1000 / fps);
    expect(s.lit()).toHaveLength(1);
    expect(s.lit()[0].alpha).toBeGreaterThan(peak * 0.8);
    // An isolated strong hit is no longer cut off by the old 180 ms lifetime cap.
    s.renderer.update(190 - 3000 / fps);
    expect(s.lit()).toHaveLength(1);
  });

  it('recycles a bounded pool without stale target bindings and clears cooldowns on reset', () => {
    const s = setup();
    for (const id of ['a', 'b', 'c']) { s.add(id); s.play(id); s.renderer.update(5); }
    expect(s.lit()).toHaveLength(2);
    s.play('a');
    expect(s.lit()).toHaveLength(2);
    s.renderer.clear();
    expect(s.lit()).toHaveLength(0);
    s.play('a');
    expect(s.lit()).toHaveLength(1);
    s.targets.get('a')!.active = false;
    s.renderer.update(1);
    expect(s.lit()).toHaveLength(0);
    s.renderer.destroyAll();
    expect(s.images.every((image) => image.destroyed)).toBe(true);
  });

  it('preserves a dark gap even when other targets evict the flash from its pool slot', () => {
    const s = setup();
    const a = s.add('a'); a.x = 100;
    s.add('b'); s.add('c');
    s.play('a'); s.renderer.update(10); s.play('b');
    s.play('c'); // a is the oldest and gets evicted
    s.play('a', 10000);
    expect(s.lit().some((image) => image.x === a.x + 3)).toBe(false);
    s.renderer.update(HIT_FEEDBACK_TIMING.darkMs);
    s.play('a');
    expect(s.lit().some((image) => image.x === a.x + 3)).toBe(true);
  });
});
