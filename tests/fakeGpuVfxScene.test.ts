import { describe, expect, it } from 'vitest';

import { makeFakeGpuLayer, makeFakeTextureManager } from './fakeGpuVfxScene';

/**
 * Der Fake ist nur so viel wert, wie er Phasers Semantik trifft. Diese Datei nagelt genau die
 * beiden Eigenschaften fest, an denen der Atlas haengt – und den `memberCount`-Guard, der einen
 * Fehlgriff sonst still verschlucken wuerde.
 */
describe('fake texture manager', () => {
  it('promotes the first added frame to firstFrame, as Texture.add does', () => {
    const textures = makeFakeTextureManager();
    const texture = textures.createCanvas('atlas', 64, 64);
    expect(texture.firstFrame).toBe('__BASE');

    texture.add('first', 0, 2, 2, 8, 8);
    texture.add('second', 0, 12, 2, 8, 8);
    expect(texture.firstFrame).toBe('first');
  });

  it('keeps getFrameNames in insertion order', () => {
    const textures = makeFakeTextureManager();
    const texture = textures.createCanvas('atlas', 64, 64);
    texture.add('a', 0, 0, 0, 1, 1);
    texture.add('b', 0, 2, 0, 1, 1);

    // Daran haengen Phasers Frame-Indizes im `frameDataTexture`.
    expect(texture.getFrameNames(true)).toEqual(['__BASE', 'a', 'b']);
    expect(texture.getFrameNames()).toEqual(['a', 'b']);
  });

  it('refuses a duplicate frame name', () => {
    const textures = makeFakeTextureManager();
    const texture = textures.createCanvas('atlas', 64, 64);
    expect(texture.add('a', 0, 0, 0, 1, 1)).not.toBeNull();
    expect(texture.add('a', 0, 8, 8, 2, 2)).toBeNull();
    expect(texture.get('a').cutWidth).toBe(1);
  });
});

describe('fake gpu layer', () => {
  it('ignores edits and patches beyond memberCount, as Phaser does', () => {
    const layer = makeFakeGpuLayer('atlas', 4);
    layer.editMember(0, {});
    expect(layer.edited).toEqual([]);

    layer.addMember();
    layer.addMember();
    layer.editMember(1, {});
    layer.editMember(2, {});
    expect(layer.edited).toEqual([1]);

    layer.patchMember(5, new Uint32Array(0));
    expect(layer.patched).toEqual([]);
  });

  it('records only real visibility transitions', () => {
    const layer = makeFakeGpuLayer('atlas', 1);
    layer.setVisible(true);
    layer.setVisible(false);
    layer.setVisible(false);
    layer.setVisible(true);
    expect(layer.visibleTransitions).toEqual([false, true]);
  });
});
