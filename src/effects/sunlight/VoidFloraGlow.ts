import type * as Phaser from 'phaser';
import { VOID_PALETTE } from '../../config';
import { createVisibleWorldView, getVisibleWorldView } from '../../graphics/CameraWorldView';
import type { GroundGlowLightFrame, LightingSystem } from '../LightingSystem';

/** Upper bound of void glow lights; decorative, so they never crowd out gameplay glow. */
export const MAX_VOID_FLORA_LIGHTS = 64;
const MARGIN_PX = 140;
/** Lily colonies light the water around them; rock colonies the rock edge and the ground below. */
interface GlowKind { readonly radiusPx: number; readonly intensity: number; readonly color: number }
const POND: GlowKind = { radiusPx: 100, intensity: .55, color: VOID_PALETTE.primary };
const ROCK: GlowKind = { radiusPx: 86, intensity: .52, color: VOID_PALETTE.primary };

interface GlowLight { x: number; y: number; radiusPx: number; intensity: number; color: number }

/**
 * Glow of void-taken flora (GDD Nachtsicht N-6) as small shadowless lights inside the light map:
 * the plant is lit together with the water and rock edge around it, fog and darkness treat it like
 * any other light, and nothing is drawn above figures. A slow breath keeps each colony alive
 * without flicker. Owned by the World's sunlight presentation; the light map scales it by night.
 */
export class VoidFloraGlow implements GroundGlowLightFrame {
  readonly lights: GlowLight[] = Array.from({ length: MAX_VOID_FLORA_LIGHTS }, () => ({ x: 0, y: 0, radiusPx: 0, intensity: 0, color: 0 }));
  lightCount = 0;
  private readonly view = createVisibleWorldView();

  constructor(private readonly lighting: Pick<LightingSystem, 'setGroundGlowLights'>) {}

  update(camera: Phaser.Cameras.Scene2D.Camera, pond: readonly number[], rock: readonly number[], timeSec: number): void {
    const view = getVisibleWorldView(camera, this.view);
    this.lightCount = 0;
    this.collect(pond, POND, view, timeSec);
    this.collect(rock, ROCK, view, timeSec);
    this.lighting.setGroundGlowLights(this, this.lightCount > 0 ? this : null, { decorative: true });
  }

  /** `points` are flat x/y/amount triples; partly infested colonies glow with their share. */
  private collect(points: readonly number[], kind: GlowKind, view: { x: number; y: number; right: number; bottom: number },
    timeSec: number): void {
    for (let i = 0; i + 2 < points.length && this.lightCount < MAX_VOID_FLORA_LIGHTS; i += 3) {
      const x = points[i], y = points[i + 1], amount = points[i + 2];
      if (amount <= .02) continue;
      if (x < view.x - MARGIN_PX || y < view.y - MARGIN_PX || x > view.right + MARGIN_PX || y > view.bottom + MARGIN_PX) continue;
      // Each colony breathes on its own 7–11 s period; stable phase from its position.
      const seed = Math.abs(Math.sin(x * 12.9898 + y * 78.233)) * 43758.5453 % 1;
      const period = 7 + 4 * seed;
      const breath = .8 + .2 * Math.sin((timeSec / period + seed) * Math.PI * 2);
      const light = this.lights[this.lightCount++];
      light.x = x; light.y = y; light.radiusPx = kind.radiusPx * (.6 + .4 * amount);
      light.intensity = kind.intensity * breath * amount; light.color = kind.color;
    }
  }

  destroy(): void {
    this.lightCount = 0;
    this.lighting.setGroundGlowLights(this, null);
  }
}
