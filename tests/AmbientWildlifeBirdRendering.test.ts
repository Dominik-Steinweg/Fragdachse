import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./AmbientWildlifePhaserHarness')).phaser);
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: () => {} }));

import { wildlifeScene } from './AmbientWildlifePhaserHarness';
import { prepareBirdVisuals, projectBirdShadow, type BirdVisual } from '../src/arena/AmbientWildlifeBirdGeometry';
import { writeBirdLayerWeights } from '../src/arena/AmbientWildlifeBirds';
import { createAmbientWildlifeLayer } from '../src/arena/AmbientWildlifeLayer';
import { AmbientWildlifeRenderer, BIRD_LAYER_DEPTHS } from '../src/arena/AmbientWildlifeRenderer';
import { AmbientWildlifeModel } from '../src/arena/AmbientWildlifeModel';
import { DEPTH, DEPTH_LIGHTING } from '../src/config';
import { AMBIENT_WILDLIFE as TUNING } from '../src/arena/AmbientWildlifeConfig';
import { createSunTuning } from '../src/effects/sunlight/SunAtmosphere';
import { createSunPath, resolveSunPath } from '../src/effects/sunlight/SunPath';
import type { WildlifePose } from '../src/arena/AmbientWildlifeGeometry';

const frame = { offsetX: 0, offsetY: 0, width: 2048, height: 2048 };
const view = { x: 0, y: 0, width: 2048, height: 2048 };
const layout = { seed: 882, trees: [{ gridX: 20, gridY: 20 }, { gridX: 40, gridY: 30 }], rocks: [], dirt: [], tracks: [],
  powerUpPedestals: [], water: Array.from({ length: 64 }, (_, i) => ({ gridX: 26 + i % 8, gridY: 40 + Math.floor(i / 8) })) };

function settledBirds(minutes: number): BirdVisual[] {
  const model = new AmbientWildlifeModel(layout, frame);
  model.update(16, [], view, minutes);
  return prepareBirdVisuals(model.animals);
}

function transformed(mesh: { xy: number[]; channels: number[]; poses: WildlifePose[] }, i: number): [number, number] {
  const q = mesh.poses[mesh.channels[i]], lx = mesh.xy[i * 2] * q.sx, ly = mesh.xy[i * 2 + 1] * q.sy;
  return [lx * q.c - ly * q.s + q.x, lx * q.s + ly * q.c + q.y];
}

describe('bird rendering', () => {
  it('draws grounded birds under the fog, flight shadows under fog and crowns, flight above the lightmap', () => {
    const harness = wildlifeScene();
    const renderer = new AmbientWildlifeRenderer(harness.scene, frame, layout);
    const depth = (name: string) => harness.scene.objects.find((o: any) => o.name === name).depth;
    expect(depth('ambient-wildlife-birds-ground')).toBe(BIRD_LAYER_DEPTHS.ground);
    expect(BIRD_LAYER_DEPTHS.ground).toBeLessThan(DEPTH.GROUND_FOG);
    expect(depth('ambient-wildlife-bird-shadows')).toBeLessThan(DEPTH.GROUND_FOG_COMPOSITE);
    expect(depth('ambient-wildlife-birds-low')).toBeGreaterThan(DEPTH_LIGHTING + .001);
    expect(depth('ambient-wildlife-birds-low')).toBeLessThan(DEPTH.CANOPY);
    expect(depth('ambient-wildlife-birds-high')).toBeGreaterThan(DEPTH.CANOPY);
    expect(depth('ambient-wildlife-birds-high')).toBeLessThan(DEPTH.LOCAL_UI);
    renderer.destroy();
    expect(harness.scene.objects.every((object: any) => !object.active)).toBe(true);
  });

  it('hands a bird from layer to layer by height without a gap and with at most two copies', () => {
    const weights = { ground: 0, low: 0, high: 0 };
    for (let h = 0; h <= 200; h += .25) {
      writeBirdLayerWeights(h, weights);
      const values = [weights.ground, weights.low, weights.high];
      expect(Math.max(...values)).toBeCloseTo(1, 6);
      expect(values.filter(v => v > 0).length).toBeLessThanOrEqual(2);
      expect(weights.ground > 0 && weights.high > 0).toBe(false);
    }
  });

  it('only darkens birds with the canopy tint', () => {
    const bird = settledBirds(12 * 60).find(v => v.animal.kind === 'magpie')!;
    let colors: number[] = [];
    const harness = wildlifeScene((_context, _indices, _vertices, c) => { colors = Array.from(c); });
    let tint = 0xffffff;
    const layer = createAmbientWildlifeLayer(harness.scene, [bird], 1, 'tint-probe', { project: (v, out) => {
      out.x = v.animal.x; out.y = v.animal.y; out.angle = v.animal.angle; out.scale = 1.3; out.radius = 40;
      out.weight = 1; out.tint = tint;
    } });
    bird.sample(1);
    layer.updatePose(view, 1); harness.render();
    const plain = colors.slice();
    expect(plain.length).toBeGreaterThan(0);
    tint = 0x40506a;
    layer.updatePose(view, 1); harness.render();
    const channel = (c: number, shift: number) => (c >>> shift) & 255;
    for (let i = 0; i < plain.length; i++) {
      for (const [shift, factor] of [[16, 0x40], [8, 0x50], [0, 0x6a]] as const) {
        expect(channel(colors[i], shift)).toBeLessThanOrEqual(Math.round(channel(plain[i], shift) * factor / 255) + 1);
      }
      expect(colors[i] >>> 24).toBe(plain[i] >>> 24);
    }
    layer.destroy();
  });

  it('casts no shadow on the ground and a longer one higher up, faint by moonlight', () => {
    const sunlight = { tuning: createSunTuning(), timeSec: 0, strength: 1, sunPath: resolveSunPath(15 * 60, null, createSunPath()) };
    const out = { x: 0, y: 0, alpha: 0 };
    expect(projectBirdShadow(0, 100, 100, sunlight, 15 * 60, out).alpha).toBe(0);
    let reach = 0;
    for (const h of [8, 30, 60, 120]) {
      projectBirdShadow(h, 100, 100, sunlight, 15 * 60, out);
      expect(Math.hypot(out.x, out.y)).toBeGreaterThan(reach);
      expect(out.alpha).toBeGreaterThan(0);
      reach = Math.hypot(out.x, out.y);
    }
    const night = { ...sunlight, strength: 0, sunPath: resolveSunPath(0, null, createSunPath()) };
    projectBirdShadow(120, 100, 100, night, 0, out);
    expect(out.alpha).toBeGreaterThan(0);
    expect(out.alpha).toBeLessThanOrEqual(.12);
    expect(projectBirdShadow(120, 100, 100, undefined, 0, out).alpha).toBe(0);
  });

  it('keeps a foraging flock with its hops, pecks and contact shadows inside its habitat footprint', () => {
    const flocks = settledBirds(12 * 60).filter(v => v.animal.kind === 'sparrow' && v.animal.bird!.phase === 'forage');
    expect(flocks.length).toBeGreaterThan(0);
    for (const flock of flocks) {
      const mesh = flock.mesh, a = flock.animal;
      for (let time = 0; time < 30; time += .37) {
        flock.sample(time);
        for (let i = 0; i < mesh.channels.length; i++) {
          const [x, y] = transformed(mesh, i);
          expect(Math.hypot(x, y) * TUNING.visualScale).toBeLessThan(a.appearance.footprint);
        }
      }
    }
  });

  it('keeps every flight shadow a non-overlapping fan through beats, banks and flock spreads', () => {
    for (const bird of settledBirds(0).concat(settledBirds(12 * 60))) {
      const a = bird.animal, state = a.bird!;
      const mesh = bird.shadow.mesh;
      expect(mesh.poses).toBe(bird.mesh.poses);
      state.altitude = 100; state.lift = state.wings = 1;
      for (const [animation, turn] of [[0, 0], [1.1, .8], [2.3, -.8], [4, 0]]) {
        a.animation = animation; a.turnSpeed = turn;
        bird.sample(animation);
        // Every fan triangle (centre, outline i, outline i + 1) keeps the winding of the whole fan.
        let sign = 0;
        for (let t = 0; t < mesh.indices.length; t += 9) {
          const [p0, p1, p2] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map(i => transformed(mesh, i));
          const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
          if (Math.abs(area) < 1e-6) continue;
          if (!sign) sign = Math.sign(area);
          expect(Math.sign(area)).toBe(sign);
        }
      }
    }
  });
});
