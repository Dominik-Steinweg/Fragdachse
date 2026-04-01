import type Phaser from 'phaser';
import { fillRadialGradientTexture } from './EffectUtils';

export const TEX_FLAME_EMBER = '__flame_ember';
export const TEX_FLAME_CORE  = '__flame_core';
export const TEX_FLAME_SPARK = '__flame_spark';
export const TEX_FLAME_GLOW  = '__flame_glow';

export const FLAME_COLORS_CORE  = [0xffee88, 0xffcc44, 0xff9922, 0xffffff];
export const FLAME_COLORS_OUTER = [0xff6622, 0xff4400, 0xdd2200, 0xcc3300];
export const FLAME_COLORS_SPARK = [0xffffff, 0xffee88, 0xffaa44, 0xff6622];

export function ensureFlameTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  fillRadialGradientTexture(textures, TEX_FLAME_EMBER, 16, [
    [0, 'rgba(255,255,255,1.0)'],
    [0.3, 'rgba(255,238,136,0.8)'],
    [0.7, 'rgba(255,153,34,0.4)'],
    [1, 'rgba(255,68,0,0.0)'],
  ]);

  fillRadialGradientTexture(textures, TEX_FLAME_CORE, 24, [
    [0, 'rgba(255,255,255,1.0)'],
    [0.4, 'rgba(255,255,200,0.7)'],
    [0.8, 'rgba(255,200,100,0.2)'],
    [1, 'rgba(255,100,0,0.0)'],
  ]);

  fillRadialGradientTexture(textures, TEX_FLAME_SPARK, 6, [
    [0, 'rgba(255,255,255,1.0)'],
    [0.5, 'rgba(255,238,136,0.6)'],
    [1, 'rgba(255,170,68,0.0)'],
  ]);

  fillRadialGradientTexture(textures, TEX_FLAME_GLOW, 48, [
    [0, 'rgba(255,200,80,0.6)'],
    [0.4, 'rgba(255,140,30,0.3)'],
    [0.7, 'rgba(255,80,0,0.1)'],
    [1, 'rgba(255,40,0,0.0)'],
  ]);
}