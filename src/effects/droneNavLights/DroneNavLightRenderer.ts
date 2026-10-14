import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../../config';
import { createVisibleWorldView, getVisibleWorldView } from '../../graphics/CameraWorldView';
import { fillRadialGradientTexture, mixColors, registerGraphicsObject } from '../EffectUtils';
import { emissiveAlpha, getEmissiveScale } from '../EmissiveScale';
import { EnemyEyeBatch } from '../EnemyEyeBatch';
import type { LightingSystem } from '../LightingSystem';
import {
  DRONE_NAV_LIGHT_COLORS, DroneNavLightModel, type DroneNavLightBand, type DroneNavLightProfile,
} from './DroneNavLightModel';

const CORE = '__drone_nav_core', HALO = '__drone_nav_halo', BLOOM = '__drone_nav_bloom';
/** Emissive scale at noon and at full night (see TimeOfDay); lights are dimmed by day, full at night. */
const DAY_EMISSIVE = .55, NIGHT_EMISSIVE = 1;
/** Slow tail beacon: one short flash per period, otherwise a dim ember. */
const BEACON_PERIOD_MS = 1700, BEACON_FLASH_MS = 170, BEACON_REST = .45;
/** Up to 4 squadrons of 14 bombers plus attack and repair drones; quads beyond this are dropped. */
const CAPACITY = 512;
/** Ground pools are the only lighting cost; the nearest ones to the view centre win. */
const MAX_POOLS = 36;
const CORE_PX = 2.6, HALO_PX = 4.6, BLOOM_PX = 12;

interface BandBatches { readonly halo: EnemyEyeBatch; readonly core: EnemyEyeBatch; readonly bloom: EnemyEyeBatch }

/**
 * Scene-owned light layer for all flying drones. Drone renderers submit during their frame
 * update; the layer flushes once before rendering, so stale drones can never keep a light.
 *
 * Per band, back to front: bloom (ADD, small soft spill, night only), halo (NORMAL, opaque
 * coloured rim that stays readable over bright ground) and core (NORMAL, near-white centre).
 * The under-canopy band sits just above the night overlay but below tree crowns; the
 * over-canopy band sits above the high-flying bomber bodies.
 */
export class DroneNavLightRenderer {
  readonly model = new DroneNavLightModel();
  private readonly bands: Readonly<Record<DroneNavLightBand, BandBatches>>;
  private readonly view = createVisibleWorldView();
  private readonly poolFrame = { lights: this.model.pools, lightCount: 0 };
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem | null) {
    fillRadialGradientTexture(scene.textures, CORE, 32, [[0, '#ffffff'], [.6, '#ffffff'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, HALO, 32, [[0, 'rgba(255,255,255,1)'], [.55, 'rgba(255,255,255,.85)'], [1, 'rgba(255,255,255,0)']]);
    fillRadialGradientTexture(scene.textures, BLOOM, 64, [[0, 'rgba(255,255,255,1)'], [.25, 'rgba(255,255,255,.45)'],
      [.6, 'rgba(255,255,255,.1)'], [1, 'rgba(255,255,255,0)']]);
    const underBloom = new EnemyEyeBatch(scene, BLOOM, CAPACITY, DEPTH_LIGHTING + .13);
    const underHalo = new EnemyEyeBatch(scene, HALO, CAPACITY, DEPTH_LIGHTING + .135);
    const underCore = new EnemyEyeBatch(scene, CORE, CAPACITY, DEPTH_LIGHTING + .14);
    const overBloom = new EnemyEyeBatch(scene, BLOOM, CAPACITY, DEPTH.CANOPY + .65);
    const overHalo = new EnemyEyeBatch(scene, HALO, CAPACITY, DEPTH.CANOPY + .66);
    const overCore = new EnemyEyeBatch(scene, CORE, CAPACITY, DEPTH.CANOPY + .67);
    underBloom.layer.setBlendMode(Phaser.BlendModes.ADD);
    overBloom.layer.setBlendMode(Phaser.BlendModes.ADD);
    this.bands = {
      'under-canopy': { bloom: underBloom, halo: underHalo, core: underCore },
      'over-canopy': { bloom: overBloom, halo: overHalo, core: overCore },
    };
    for (const [band, batches] of Object.entries(this.bands)) {
      batches.bloom.layer.setName(`drone-nav-blooms:${band}`);
      batches.halo.layer.setName(`drone-nav-halos:${band}`);
      batches.core.layer.setName(`drone-nav-cores:${band}`);
      for (const batch of [batches.bloom, batches.halo, batches.core]) registerGraphicsObject(scene, 'objectiveMarkers', batch.layer);
    }
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.flush, this);
  }

  /** Called by a drone renderer for each drone it displays this frame. */
  submit(x: number, y: number, heading: number, alpha: number, profile: DroneNavLightProfile, key: object,
    lateralScale = 1): void {
    if (!this.destroyed) this.model.submit(x, y, heading, alpha, profile, key, lateralScale);
  }

  private flush(): void {
    if (this.destroyed) return;
    const model = this.model, count = model.pointCount;
    for (const batches of Object.values(this.bands)) { batches.bloom.begin(count); batches.halo.begin(count); batches.core.begin(count); }
    const night = Math.max(0, Math.min(1, (getEmissiveScale() - DAY_EMISSIVE) / (NIGHT_EMISSIVE - DAY_EMISSIVE)));
    // Small and present by day, full at night; the spill only exists in the dark.
    const lightAlpha = .45 + .55 * night, bloomAlpha = emissiveAlpha(.75) * night;
    const now = this.scene.time.now;
    for (let i = 0; i < count; i++) {
      const p = model.points[i], batches = this.bands[p.band], color = DRONE_NAV_LIGHT_COLORS[p.kind];
      let strength = p.kind === 'wing' ? .55 : 1;
      if (p.kind === 'tail') {
        const t = ((now / BEACON_PERIOD_MS + p.phase) % 1) * BEACON_PERIOD_MS;
        strength = t < BEACON_FLASH_MS ? 1 : BEACON_REST;
      }
      const alpha = p.alpha * strength;
      const core = CORE_PX * p.size * (p.kind === 'wing' ? .8 : p.kind === 'tail' ? 1.15 : 1);
      // The nose light is slightly drawn out along the flight direction.
      const stretch = p.kind === 'nose' ? 1.35 : 1;
      batches.bloom.write(p.x, p.y, BLOOM_PX * p.size * strength, BLOOM_PX * p.size * strength, 0, color, alpha * bloomAlpha);
      batches.halo.write(p.x, p.y, HALO_PX * p.size * stretch, HALO_PX * p.size, p.heading, color, alpha * lightAlpha * .85);
      batches.core.write(p.x, p.y, core * stretch, core, p.heading, mixColors(color, 0xffffff, .55), alpha * lightAlpha);
    }
    const view = getVisibleWorldView(this.scene.cameras.main, this.view);
    model.limitPools(view.centerX, view.centerY, MAX_POOLS);
    this.poolFrame.lightCount = model.poolCount;
    this.lighting?.setGroundGlowLights(this, this.poolFrame);
    model.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.flush, this);
    this.lighting?.setGroundGlowLights(this, null);
    for (const batches of Object.values(this.bands)) { batches.bloom.destroy(); batches.halo.destroy(); batches.core.destroy(); }
    this.model.clear();
  }
}
