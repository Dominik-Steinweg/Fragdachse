import { describe, expect, it } from 'vitest';
import { EnemyEyeGlowModel, writeEyePose, type EnemyEyePose, type EnemyEyeSource, type EyeSpritePose } from '../src/effects/EnemyEyeGlowModel';
import { PIPELINE_ASSETS } from '../src/config/pipelineAssets';

const asset = PIPELINE_ASSETS.find(a => a.id === 'zombie-badger')!;
function enemy(): EnemyEyeSource {
  return { kind: asset.id, faction: 'hostile', getHp: () => 10,
    sprite: { x: 100, y: 120, rotation: 0, scaleX: .25, scaleY: .25,
      displayOriginX: 64, displayOriginY: 64, flipX: false, flipY: false, alpha: 1, active: true, visible: true,
      texture: { key: asset.sheetTextureKey }, frame: { name: '0', realWidth: 128, realHeight: 128 } } };
}
const view = { x: 0, y: 0, width: 1000, height: 1000 };

describe('frame-bound enemy eyes', () => {
  it('uses the displayed frame and interpolated pose, without a separate animation clock', () => {
    const model = new EnemyEyeGlowModel(), source = enemy();
    model.update([source], view);
    const start = { ...model.eyes[0] };
    model.update([{ ...source, sprite: { ...source.sprite, x: 155, y: 183, frame: { ...source.sprite.frame, name: '5' } } }], view);
    const anchor = asset.eyeAnchors!.frames[5].left;
    expect(model.eyes[0].x).toBeCloseTo(155 + (anchor.x * 128 - 64) * .25);
    expect(model.eyes[0].y).toBeCloseTo(183 + (anchor.y * 128 - 64) * .25);
    model.update([source], view);
    expect(model.eyes[0]).toEqual(start);
    model.update([{ ...source, sprite: { ...source.sprite, texture: { key: asset.textureKey }, frame: { ...source.sprite.frame, name: '__BASE' } } }], view);
    expect(model.eyes[0]).toEqual(start);
  });

  it('transforms origin, rotation, signed/nonuniform scale and both flips', () => {
    const anchor = { x: .25, y: .75, width: .04, height: .02, rotation: 0 };
    const pose: EyeSpritePose = { ...enemy().sprite, rotation: Math.PI / 2,
      scaleX: 2, scaleY: 3, displayOriginX: 20, displayOriginY: 10, flipX: true };
    const out = {} as EnemyEyePose;
    writeEyePose(out, anchor, pose, 0x123456);
    expect(out.x).toBeCloseTo(100 - (.75 * 128 - 10) * 3);
    expect(out.y).toBeCloseTo(120 + (.75 * 128 - 20) * 2);
    expect(out.width).toBeCloseTo(.04 * 128 * 2);
    expect(out.height).toBeCloseTo(.02 * 128 * 3);
    expect(out.color).toBe(0x123456);
    writeEyePose(out, anchor, { ...pose, scaleX: -2, flipY: true }, 0);
    expect(out.x).toBeCloseTo(100 - (.25 * 128 - 10) * 3);
    expect(out.y).toBeCloseTo(120 - (.75 * 128 - 20) * 2);
  });

  it('removes hidden, dead, allied, inactive and distant sources immediately', () => {
    const model = new EnemyEyeGlowModel(), source = enemy();
    model.update([source], view);
    expect(model.lightCount).toBe(1);
    for (const absent of [
      { ...source, getHp: () => 0 }, { ...source, faction: 'allied' as const },
      ...[{ visible: false }, { active: false }, { alpha: 0 }, { x: -1000 }, { frame: { ...source.sprite.frame, name: 'unknown' } }]
        .map(change => ({ ...source, sprite: { ...source.sprite, ...change } })),
    ]) {
      model.update([absent], view);
      expect(model.eyeCount).toBe(0); expect(model.lightCount).toBe(0);
    }
    model.update([source], view); model.clear();
    expect(model.eyeCount).toBe(0); expect(model.lightCount).toBe(0);
  });

  it('keeps edge lights and follows sprite opacity', () => {
    const model = new EnemyEyeGlowModel(), source = enemy();
    model.update([{ ...source, sprite: { ...source.sprite, x: -5, alpha: .5 } }], view);
    expect(model.eyeCount).toBe(2); expect(model.lightCount).toBe(1);
    expect(model.lights[0].x).toBeCloseTo((model.eyes[0].x + model.eyes[1].x) / 2);
    expect(model.eyes[0].alpha).toBe(.5);
    const intensity = model.lights[0].intensity;
    model.update([source], view);
    expect(model.lights[0].intensity).toBeCloseTo(intensity * 2);
  });
});
