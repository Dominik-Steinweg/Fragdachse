import * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../../config';
import { fillRadialGradientTexture, registerGraphicsObject } from '../EffectUtils';
import { emissiveAlpha } from '../EmissiveScale';
import { EnemyEyeBatch } from '../EnemyEyeBatch';

const POOL = '__kraken_glow_pool', HALO = '__kraken_glow_halo', CORE = '__kraken_glow_core';
interface Quad { x: number; y: number; w: number; h: number; rotation: number; color: number; alpha: number }

/**
 * Soft light of the kraken above the light map: pools (eye aura, brood ember, hatch flash, deep ember,
 * roar bloom) and the sucker dots (violet halo + whiter core). Three instanced layers per owner; every
 * frame is a full projection (begin → add → flush), nothing is emitted or kept between frames.
 */
export class KrakenGlowLayer {
  private readonly pools: EnemyEyeBatch;
  private readonly halos: EnemyEyeBatch;
  private readonly cores: EnemyEyeBatch;
  private readonly poolQuads: Quad[] = [];
  private readonly haloQuads: Quad[] = [];
  private readonly coreQuads: Quad[] = [];
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    fillRadialGradientTexture(scene.textures, POOL, 64, [[0, 'rgba(255,255,255,1)'], [.25, 'rgba(255,255,255,.62)'],
      [.55, 'rgba(255,255,255,.2)'], [.8, 'rgba(255,255,255,.05)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, HALO, 32, [[0, 'rgba(255,255,255,1)'], [.3, 'rgba(255,255,255,.5)'],
      [.65, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, CORE, 16, [[0, 'rgba(255,255,255,1)'], [.45, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]);
    this.pools = new EnemyEyeBatch(scene, POOL, 64, DEPTH_LIGHTING + .09);
    this.halos = new EnemyEyeBatch(scene, HALO, 512, DEPTH_LIGHTING + .105);
    this.cores = new EnemyEyeBatch(scene, CORE, 512, DEPTH_LIGHTING + .11);
    this.pools.layer.setBlendMode(Phaser.BlendModes.ADD).setName('kraken-glow-pools');
    this.halos.layer.setBlendMode(Phaser.BlendModes.ADD).setName('kraken-sucker-halos');
    this.cores.layer.setBlendMode(Phaser.BlendModes.ADD).setName('kraken-sucker-cores');
    for (const batch of [this.pools, this.halos, this.cores]) registerGraphicsObject(scene, 'bossIntro', batch.layer);
  }

  begin(): void { this.poolQuads.length = 0; this.haloQuads.length = 0; this.coreQuads.length = 0; }

  /** A soft elliptical pool of light; `alpha` before the day/night emissive scale. */
  pool(x: number, y: number, width: number, height: number, rotation: number, color: number, alpha: number): void {
    if (alpha > .004 && width > 0 && height > 0) this.poolQuads.push({ x, y, w: width, h: height, rotation, color, alpha });
  }

  /** One glowing cup: a wide violet halo and a small hot core. */
  sucker(x: number, y: number, radiusPx: number, halo: number, core: number, alpha: number): void {
    if (alpha <= .004) return;
    const h = Math.max(5, radiusPx * 4.2), c = Math.max(2.2, radiusPx * 1.5);
    this.haloQuads.push({ x, y, w: h, h, rotation: 0, color: halo, alpha: alpha * .55 });
    this.coreQuads.push({ x, y, w: c, h: c, rotation: 0, color: core, alpha: Math.min(1, alpha) });
  }

  flush(): void {
    if (this.destroyed) return;
    for (const [batch, quads] of [[this.pools, this.poolQuads], [this.halos, this.haloQuads], [this.cores, this.coreQuads]] as const) {
      batch.begin(quads.length);
      for (const q of quads) batch.write(q.x, q.y, q.w, q.h, q.rotation, q.color, emissiveAlpha(Math.min(1, q.alpha)));
    }
  }

  clear(): void { this.begin(); this.flush(); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const batch of [this.pools, this.halos, this.cores]) batch.destroy();
  }
}
