import { describe, expect, it } from 'vitest';
import { HeldWeaponFeedbackModel } from '../src/effects/weapon/HeldWeaponFeedbackModel';
import { HeldItemVisual } from '../src/entities/HeldItemVisual';
import { getHeldWeaponGameplayMuzzleOrigin, getHeldItemSpriteSpec } from '../src/loadout/HeldItemVisuals';
import { WEAPON_FEEDBACK_PROFILES as profiles, WEAPON_FEEDBACK_MAX_STACK } from '../src/config/weaponFeedback';

const pose = () => ({ recoilPx: 0, rotationRad: 0 });

describe('held weapon feedback motion', () => {
  it('samples the same pose at a given time regardless of frame count and returns exactly to rest', () => {
    const a = new HeldWeaponFeedbackModel(), b = new HeldWeaponFeedbackModel();
    a.fire(profiles.heavy, 0); b.fire(profiles.heavy, 0);
    const pa = pose(), pb = pose();
    for (let t = 0; t < 90; t += 1000 / 144) a.sample(t, pa);
    a.sample(90, pa); b.sample(90, pb);
    expect(pa).toEqual(pb);
    expect(pa.recoilPx).toBeGreaterThan(0);
    a.sample(1000, pa);
    expect(pa).toEqual(pose());
    expect(a.isActive(1000)).toBe(false);
  });

  it('restarts from the current pose and bounds repeated fire', () => {
    const model = new HeldWeaponFeedbackModel(), out = pose(), before = pose();
    model.fire(profiles.rapid, 0);
    for (let t = 10; t < 1000; t += 10) {
      model.sample(t, before);
      model.fire(profiles.rapid, t);
      model.sample(t, out);
      expect(out).toEqual(before);
      model.sample(t + 10, out);
      expect(out.recoilPx).toBeLessThanOrEqual(profiles.rapid.kickPx * WEAPON_FEEDBACK_MAX_STACK);
    }
  });

  it('refreshes a stream without resetting its phase and releases on stop or timeout', () => {
    const model = new HeldWeaponFeedbackModel(), out = pose(), before = pose();
    expect(model.fire(profiles.stream, 0)).toBe(true);
    model.sample(100, before);
    expect(model.fire(profiles.stream, 100)).toBe(false);
    model.sample(100, out);
    expect(out).toEqual(before);
    model.stopSustained(100);
    model.sample(100, out);
    expect(out).toEqual(before);
    model.sample(100 + profiles.stream.returnMs, out);
    expect(out).toEqual(pose());
    model.fire(profiles.stream, 1000);
    model.sample(2000, out);
    expect(out).toEqual(pose());
    model.reset();
    model.sample(1001, out);
    expect(out).toEqual(pose());
  });
});

function visualFixture() {
  const sourceSize = 32 * (getHeldItemSpriteSpec('GLOCK')!.sourceScale ?? 1);
  const image = {
    active: true, visible: false, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
    displayWidth: 0, displayHeight: 0, originX: 0, originY: 0,
    frame: { cutWidth: sourceSize, cutHeight: sourceSize },
    setDepth() { return this; },
    setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; },
    setTexture(key: string) {
      const item = ['GLOCK', 'AWP', 'HE_GRENADE'].map(id => getHeldItemSpriteSpec(id)!).find(spec => spec.textureKey === key);
      const size = 32 * (item?.sourceScale ?? 1);
      this.frame = key === getHeldItemSpriteSpec('HOLY_HAND_GRENADE')!.textureKey
        ? { cutWidth: 6, cutHeight: 7 } : { cutWidth: size, cutHeight: size };
      return this;
    },
    setVisible(v: boolean) { this.visible = v; return this; },
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
    setRotation(r: number) { this.rotation = r; return this; },
    setDisplaySize(w: number, h: number) {
      this.displayWidth = w; this.displayHeight = h;
      this.scaleX = w / this.frame.cutWidth; this.scaleY = h / this.frame.cutHeight; return this;
    },
    setAlpha() { return this; }, destroy() { this.active = false; },
  };
  let images = 0;
  const scene = { time: { now: 0 }, textures: { exists: () => true }, add: { image: () => { images++; return image; } } };
  const visual = new HeldItemVisual(scene as never, 1);
  return { image, scene, visual, imageCount: () => images };
}

describe('animated held item geometry and lifetime', () => {
  it('preserves logical size across high-resolution weapons/utilities and restores legacy fallback scale', () => {
    const { visual, image, imageCount } = visualFixture();
    visual.setItem('GLOCK');
    visual.sync(0, 0, 0, 32, true);
    expect(image.displayWidth).toBe(32);
    expect(image.displayHeight).toBe(32);
    expect(image.originX).toBe(getHeldItemSpriteSpec('GLOCK')!.gripX / 32);
    visual.setItem('HE_GRENADE');
    visual.sync(0, 0, 0, 64, true);
    expect(image.displayWidth).toBe(64);
    expect(image.displayHeight).toBe(64);
    expect(image.originY).toBe(getHeldItemSpriteSpec('HE_GRENADE')!.gripY / 32);
    visual.setItem('HOLY_HAND_GRENADE');
    visual.sync(0, 0, 0, 64, true);
    expect(image.displayWidth).toBe(12);
    expect(image.displayHeight).toBe(14);
    expect(image.originY).toBe(getHeldItemSpriteSpec('HOLY_HAND_GRENADE')!.gripY / 7);
    expect(imageCount()).toBe(1);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('keeps the muzzle on the rendered weapon at rotation %f', (rotation) => {
    const { visual, scene, image } = visualFixture();
    visual.setItem('GLOCK');
    const gameplay = getHeldWeaponGameplayMuzzleOrigin('GLOCK', 100, 200, rotation, 64);
    visual.playShot('GLOCK', profiles.light);
    scene.time.now = 15;
    visual.sync(100, 200, rotation, 64, true);
    const rendered = { x: 0, y: 0, rotation: 0, itemId: '' };
    expect(visual.readWeaponPose(rendered)).toBe(true);
    const point = visual.getMuzzleOrigin(100, 200, rotation, 64)!;
    expect(point.x).toBeCloseTo(rendered.x);
    expect(point.y).toBeCloseTo(rendered.y);
    const spec = getHeldItemSpriteSpec('GLOCK')!;
    const localX = (spec.muzzleX - spec.gripX) * 2, localY = (spec.muzzleY - spec.gripY) * 2;
    expect(rendered.x).toBeCloseTo(image.x + localX * Math.cos(image.rotation) - localY * Math.sin(image.rotation));
    expect(getHeldWeaponGameplayMuzzleOrigin('GLOCK', 100, 200, rotation, 64)).toEqual(gameplay);
  });

  it('ignores a stale slot until acknowledgement, honors a deliberate switch, and reuses one image', () => {
    const { visual, scene, image, imageCount } = visualFixture();
    visual.setItem('GLOCK');
    visual.playShot('AWP', profiles.precision);
    scene.time.now = 10;
    visual.setItem('GLOCK'); // older snapshot
    visual.playShot('AWP', profiles.precision); // repeated event must retain the stale-slot guard
    visual.setItem('GLOCK');
    visual.sync(0, 0, 0, 32, true);
    const out = { x: 0, y: 0, rotation: 0, itemId: '' };
    visual.readWeaponPose(out);
    expect(out.itemId).toBe('AWP');
    visual.setItem('GLOCK', true);
    visual.sync(0, 0, 0, 32, true);
    expect(image.rotation).toBe(0);
    expect(imageCount()).toBe(1);
    visual.playShot('GLOCK', profiles.light);
    visual.sync(0, 0, 0, 32, false);
    scene.time.now += 20;
    visual.sync(0, 0, 0, 32, true);
    expect(image.rotation).toBe(0);
    visual.destroy();
    expect(visual.readWeaponPose(out)).toBe(false);
  });
});
