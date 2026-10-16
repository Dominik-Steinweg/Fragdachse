import * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../../config';
import materialLook from '../../config/krakenMaterialLighting.json';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { disposeShaderWarmupNode } from '../../graphics/disposeShaderWarmupNode';
import { registerGraphicsObject } from '../EffectUtils';
import { emissiveAlpha } from '../EmissiveScale';
import { KRAKEN_EMISSION_FRAGMENT, KRAKEN_EMISSION_PROGRAM } from './krakenEmissionShader';
import type { KrakenBroodMaterial } from './submersionShader';

export const KRAKEN_EMISSION = materialLook.emission;

/** What a view's companion lights this frame. Drives are multipliers; 0 hides that part. */
export interface KrakenEmissiveInput {
  /** Eye/emission-atlas drive (eyes of a body, the splitting core of a hatching egg). */
  readonly eye: number;
  /** Ember strength (KRAKEN_BROOD units) and whether it lights the whole sprite (an egg) or only brood discs. */
  readonly glow?: { readonly strength: number; readonly whole: boolean } | null;
  readonly brood?: KrakenBroodMaterial | null;
  readonly alpha: number;
  /** Colour family of the emission atlas: ember eyes, or the brood's violet (an egg's splitting core). */
  readonly tone?: 'eye' | 'brood';
}
export interface KrakenEmissiveSource {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly emission: Phaser.Textures.Frame;
  readonly elevation: Phaser.Textures.Frame;
  readonly maskKey: string;
  readonly encoding: { readonly min: number; readonly max: number };
  readonly waterLevel: number;
}

/** Logical canvas rectangle [x0, y0, x1, y1] that actually glows, or null. Pure; exported for tests. */
export function krakenEmissiveRect(emission: { x: number; y: number; width: number; height: number; realWidth: number; realHeight: number },
  input: KrakenEmissiveInput, marginLogical: readonly [number, number]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    x0 = Math.min(x0, ax); y0 = Math.min(y0, ay); x1 = Math.max(x1, bx); y1 = Math.max(y1, by);
  };
  // A 1x1 (or 2x2) emission trim is an empty frame: the eyes are closed in this pose.
  if (input.eye > 0 && emission.width > 2 && emission.height > 2) add(emission.x / emission.realWidth, emission.y / emission.realHeight,
    (emission.x + emission.width) / emission.realWidth, (emission.y + emission.height) / emission.realHeight);
  if (input.glow && input.glow.strength > 0) {
    if (input.glow.whole) add(0, 0, 1, 1);
    else for (const [x, y, r] of input.brood?.discs ?? []) add(x! - r!, y! - r!, x! + r!, y! + r!);
  }
  if (x0 > x1) return null;
  return [Math.max(0, x0 - marginLogical[0]), Math.max(0, y0 - marginLogical[1]), Math.min(1, x1 + marginLogical[0]), Math.min(1, y1 + marginLogical[1])];
}

/**
 * Additive companion of one KrakenSpriteView above the light map. Owned and pooled with its view;
 * shares one program across all views (warmed by KrakenShaderWarmup). It borrows the view's atlas
 * frames and water mask for the current frame only and never outlives the view.
 */
export class KrakenEmissionQuad {
  private readonly object: Phaser.GameObjects.Shader;
  private readonly u = {
    quad: [0, 0, 1, 1], emissionUV: [0, 0, 1, 1], emissionTrim: [0, 0, 1, 1], emissionSize: [1, 1],
    elevationUV: [0, 0, 1, 1], elevationTrim: [0, 0, 1, 1], elevationSize: [1, 1], elevationMin: 0, elevationMax: 1,
    waterLevel: 0, display: [1, 1], eye: 0, taps: 0, glow: [0, 0, 0, 0], whole: 0, alpha: 1,
    eyeColor: KRAKEN_EMISSION.eyeColor as readonly number[], eyeHot: KRAKEN_EMISSION.eyeHot as readonly number[],
    brood: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] as number[][],
  };
  private textures: readonly string[] = [];
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    const u = this.u, e = KRAKEN_EMISSION;
    this.object = scene.add.shader({ name: KRAKEN_EMISSION_PROGRAM, shaderName: KRAKEN_EMISSION_PROGRAM, fragmentSource: KRAKEN_EMISSION_FRAGMENT,
      setupUniforms: (set: (name: string, value: number | readonly number[]) => void) => {
        set('uEmission', 0); set('uElevation', 1); set('uWater', 2);
        set('uQuad', u.quad); set('emissionUV', u.emissionUV); set('emissionTrim', u.emissionTrim); set('emissionSize', u.emissionSize);
        set('elevationUV', u.elevationUV); set('elevationTrim', u.elevationTrim); set('elevationSize', u.elevationSize);
        set('elevationMin', u.elevationMin); set('elevationMax', u.elevationMax); set('waterLevel', u.waterLevel); set('uFadeEnd', e.fadeEnd);
        set('uDisplay', u.display); set('uEye', u.eye); set('uEyeGain', e.eyeGain); set('uHaloPx', e.haloPx); set('uHaloTaps', u.taps);
        set('uHalo', e.halo); set('uAlpha', u.alpha); set('uGlowWhole', u.whole); set('uEyeColor', u.eyeColor); set('uEyeHot', u.eyeHot);
        set('uGlow', u.glow);
        for (let i = 0; i < 6; i++) set(`broodDisc${i}`, u.brood[i]!);
      },
    }, 0, 0, 1, 1, ['__WHITE', '__WHITE', '__WHITE']);
    this.object.setDepth(DEPTH_LIGHTING + .1).setBlendMode(Phaser.BlendModes.ADD).setVisible(false).setName('kraken-emission');
    const node = this.object.renderNode;
    this.object.once('destroy', () => disposeShaderWarmupNode(node));
    registerGraphicsObject(scene, 'bossIntro', this.object);
  }

  sync(source: KrakenEmissiveSource, input: KrakenEmissiveInput): void {
    if (this.destroyed) return;
    const s = source.sprite, e = KRAKEN_EMISSION, display = [Math.abs(s.displayWidth), Math.abs(s.displayHeight)];
    const margin = (e.haloPx + e.marginPx) * 1.2;
    const rect = input.alpha > 0 ? krakenEmissiveRect(source.emission, input, [margin / display[0]!, margin / display[1]!]) : null;
    if (!rect || !s.visible) { this.hide(); return; }
    const u = this.u, em = source.emission, el = source.elevation;
    u.quad = rect; u.display = display;
    u.emissionUV = [em.u0, em.v0, em.u1, em.v1]; u.emissionTrim = [em.x, em.y, em.width, em.height]; u.emissionSize = [em.realWidth, em.realHeight];
    u.elevationUV = [el.u0, el.v0, el.u1, el.v1]; u.elevationTrim = [el.x, el.y, el.width, el.height]; u.elevationSize = [el.realWidth, el.realHeight];
    u.elevationMin = source.encoding.min; u.elevationMax = source.encoding.max; u.waterLevel = source.waterLevel;
    u.eye = input.eye; u.alpha = emissiveAlpha(input.alpha);
    u.eyeColor = input.tone === 'brood' ? e.glowColor : e.eyeColor; u.eyeHot = input.tone === 'brood' ? e.broodHot : e.eyeHot;
    u.taps = e.haloTaps[getGraphicsQualityProfile(this.scene).level];
    const glow = input.glow && input.glow.strength > 0 ? input.glow : null;
    u.glow = glow ? [e.glowColor[0]!, e.glowColor[1]!, e.glowColor[2]!, glow.strength * e.glowGain] : [0, 0, 0, 0];
    u.whole = glow?.whole ? 1 : 0;
    for (let i = 0; i < 6; i++) u.brood[i] = !glow?.whole ? [...(input.brood?.discs[i] ?? [0, 0, 0, 0])] : [0, 0, 0, 0];
    const keys = [em.texture.key, el.texture.key, source.maskKey];
    if (keys.some((key, i) => key !== this.textures[i])) { this.object.setTextures(keys); this.textures = keys; }
    // Place the quad over its logical rectangle of the sprite's canvas (origin, scale and rotation of the view).
    const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
    const dx = (cx - s.originX) * display[0]!, dy = (cy - s.originY) * display[1]!;
    const c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
    this.object.setPosition(s.x + dx * c - dy * sn, s.y + dx * sn + dy * c).setRotation(s.rotation)
      .setDisplaySize((rect[2] - rect[0]) * display[0]!, (rect[3] - rect[1]) * display[1]!).setVisible(true);
  }

  hide(): void { if (!this.destroyed) this.object.setVisible(false); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.object.destroy(); this.textures = [];
  }
}
