import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { PIPELINE_ASSETS } from '../src/config/pipelineAssets';
import { getWalkingSheetForStaticTexture, preloadBadgerAnimationAssets, registerBadgerAnimations,
  syncBadgerWalkingAnimation } from '../src/animations/BadgerAnimations';

describe('selected figure animations', () => {
  it('loads every figure with gutters and registers authored move and idle frames once', () => {
    const spritesheet = vi.fn();
    preloadBadgerAnimationAssets({ spritesheet } as unknown as Phaser.Loader.LoaderPlugin);
    const create = vi.fn(), generateFrameNumbers = vi.fn((_key, config) => config.frames);
    const keys = new Set<string>();
    const anims = { exists: (key: string) => keys.has(key), generateFrameNumbers,
      create: (config: { key: string }) => { keys.add(config.key); create(config); } };
    registerBadgerAnimations(anims as unknown as Phaser.Animations.AnimationManager);
    registerBadgerAnimations(anims as unknown as Phaser.Animations.AnimationManager);
    const figures = PIPELINE_ASSETS.filter(a => a.clips.some(clip => clip.name === 'move'));
    expect(create).toHaveBeenCalledTimes(figures.reduce((n,a) => n + a.clips.filter(c => c.name === 'move' || c.name === 'idle').length, 0));
    for (const asset of PIPELINE_ASSETS.filter(a => !a.clips.some(clip => clip.name === 'move'))) {
      expect(getWalkingSheetForStaticTexture(asset.textureKey)).toBeNull();
    }
    for (const asset of figures) {
      const sheet = getWalkingSheetForStaticTexture(asset.textureKey)!;
      expect(spritesheet).toHaveBeenCalledWith(sheet.textureKey, asset.sheetPath, {
        frameWidth: asset.sourceSize, frameHeight: asset.sourceSize,
        margin: asset.layout.margin, spacing: asset.layout.spacing, endFrame: asset.layout.frameCount - 1,
      });
      expect(generateFrameNumbers).toHaveBeenCalledWith(sheet.textureKey, { frames: asset.clips[0].frames });
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        key: sheet.animationKey, frameRate: asset.clips[0].frameRate, repeat: -1,
      }));
      expect(sheet.frames).not.toContain(asset.idleFrame);
      if (sheet.idle) {
        const idle = asset.clips.find(c => c.name === 'idle')!;
        expect(generateFrameNumbers).toHaveBeenCalledWith(sheet.textureKey, { frames: idle.frames });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ key: sheet.idle.animationKey, frameRate: idle.frameRate, repeat: -1 }));
      }
    }
  });

  it('does not restart a moving sprite and returns to the dedicated idle frame on stop', () => {
    const sheet = getWalkingSheetForStaticTexture('enemy_zombie_badger')!;
    const view: any = { texture: { key: sheet.textureKey }, frame: { name: 0 },
      anims: { currentAnim: null, isPlaying: false, setProgress: vi.fn(),
        stop: vi.fn(() => { view.anims.isPlaying = false; }) },
      play: vi.fn((key) => { view.anims.currentAnim = { key }; view.anims.isPlaying = true; }),
      setFrame: vi.fn((frame) => { view.frame.name = String(frame); }) };
    syncBadgerWalkingAnimation(view, true);
    syncBadgerWalkingAnimation(view, true);
    expect(view.play).toHaveBeenCalledTimes(1);
    view.frame.name = '5';
    syncBadgerWalkingAnimation(view, false);
    expect(view.anims.isPlaying).toBe(false);
    expect(view.frame.name).toBe('0');
    syncBadgerWalkingAnimation(view, false);
    expect(view.anims.stop).toHaveBeenCalledTimes(1);
  });
  it('breathes while standing, resumes walking, and holds the rest pose while inactive', () => {
    const sheet = getWalkingSheetForStaticTexture('badger')!;
    expect(sheet.idle).toBeDefined();
    const view: any = { texture: { key: sheet.textureKey }, frame: { name: '0' },
      anims: { currentAnim: null, isPlaying: false, setProgress: vi.fn(),
        stop: vi.fn(() => { view.anims.isPlaying = false; }) },
      play: vi.fn((key) => { view.anims.currentAnim = { key }; view.anims.isPlaying = true; }),
      setFrame: vi.fn((frame) => { view.frame.name = String(frame); }) };
    syncBadgerWalkingAnimation(view, false);
    syncBadgerWalkingAnimation(view, false);
    expect(view.play).toHaveBeenCalledTimes(1);
    expect(view.play).toHaveBeenLastCalledWith(sheet.idle!.animationKey);
    expect(view.anims.setProgress).not.toHaveBeenCalled();
    syncBadgerWalkingAnimation(view, true);
    expect(view.play).toHaveBeenLastCalledWith(sheet.animationKey);
    syncBadgerWalkingAnimation(view, false);
    expect(view.play).toHaveBeenLastCalledWith(sheet.idle!.animationKey);
    view.frame.name = String(sheet.idle!.frames[3]);
    syncBadgerWalkingAnimation(view, false, false);
    expect(view.anims.isPlaying).toBe(false);
    expect(view.frame.name).toBe('0');
    syncBadgerWalkingAnimation(view, true, false);
    expect(view.anims.stop).toHaveBeenCalledTimes(1);
    syncBadgerWalkingAnimation(view, false, true);
    expect(view.play).toHaveBeenLastCalledWith(sheet.idle!.animationKey);
  });
});
