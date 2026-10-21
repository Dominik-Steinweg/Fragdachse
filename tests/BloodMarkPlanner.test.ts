import { describe, expect, it } from 'vitest';
import { BLOOD_HIT_VFX } from '../src/config';
import { BLOOD_FIELD_VERTICES, BLOOD_FIELD_WORDS, BloodChannel, BloodFieldModel, BloodMarkKind } from '../src/effects/blood/BloodFieldModel';
import { BloodMarkPlanner } from '../src/effects/blood/BloodMarkPlanner';
import { createBloodLanding, landBloodFlight, type BloodTerrain } from '../src/effects/blood/BloodTerrain';

/** 32 px grid at the origin: a rock cell at gridX 5, water for x >= 400, a deck over 400..464. */
function terrain(): BloodTerrain {
  const rockLeft = 160, rockRight = 192;
  return {
    traceObstacle: (sx, sy, ex, ey) => {
      const dx = ex - sx;
      if (dx <= 0 || sx >= rockLeft || ex < rockLeft || sy < 0 || sy > 32) return null;
      const t = (rockLeft - sx) / dx;
      return { x: rockLeft, y: sy + (ey - sy) * t, distance: Math.hypot(ex - sx, ey - sy) * t, kind: 'rock' };
    },
    waterDepth: x => x - 400,
    onDeck: (x, y) => x >= 400 && x < 464 && y >= 64 && y < 96,
    bounds: { x: 0, y: 0, width: 1000, height: 1000 },
    gridX: 0,
    gridY: 0,
  };
  void rockRight;
}

const rules = { landingDepthPx: -2, overShare: 0.15, overDepthPx: [6, 18] as const };

describe('blood landing', () => {
  it('stops spray at a rock face instead of letting it fly over the rock', () => {
    const landing = landBloodFlight(terrain(), 100, 16, 260, 16, 0.9, rules, createBloodLanding());
    expect(landing.surface).toBe('rockFace');
    expect(landing.x).toBeLessThanOrEqual(160);
    expect(landing.travel).toBeLessThan(160);
    // The face normal points back to the open ground.
    expect(landing.nx).toBe(-1);
  });

  it('lets only the seeded share clear the face onto the rock top', () => {
    const landing = landBloodFlight(terrain(), 100, 16, 260, 16, 0.05, rules, createBloodLanding());
    expect(landing.surface).toBe('rockTop');
    expect(landing.x).toBeGreaterThan(160);
  });

  it('lands in water, on a standing deck over water, or on ground', () => {
    const t = terrain();
    expect(landBloodFlight(t, 300, 200, 450, 200, 1, rules, createBloodLanding()).surface).toBe('water');
    expect(landBloodFlight(t, 300, 80, 430, 80, 1, rules, createBloodLanding()).surface).toBe('deck');
    expect(landBloodFlight(t, 300, 200, 350, 200, 1, rules, createBloodLanding()).surface).toBe('ground');
  });

  it('keeps blood inside the World', () => {
    const landing = landBloodFlight(terrain(), 990, 500, 1100, 500, 1, rules, createBloodLanding());
    expect(landing.x).toBeLessThan(1000);
  });
});

describe('BloodMarkPlanner', () => {
  const hit = (planner: BloodMarkPlanner, x: number, y: number, seed: number, nowMs = 0, isKill = false) => {
    planner.beginHit({ x, y, dirX: 1, dirY: 0, totalDamage: 30, isKill, seed, nowMs });
    const landing = planner.land(x, y, x + 50, y, 0.9, createBloodLanding());
    planner.flight('streak', landing, x, y, 0.6, 1, 200);
    planner.endHit();
  };

  it('is deterministic for a seed and field state', () => {
    const a = new BloodFieldModel(256), b = new BloodFieldModel(256);
    const pa = new BloodMarkPlanner(a), pb = new BloodMarkPlanner(b);
    pa.setTerrain(terrain()); pb.setTerrain(terrain());
    hit(pa, 100, 300, 42); hit(pb, 100, 300, 42);
    expect(Array.from(a.data.subarray(0, a.count * BLOOD_FIELD_WORDS * BLOOD_FIELD_VERTICES))).toEqual(Array.from(b.data.subarray(0, b.count * BLOOD_FIELD_WORDS * BLOOD_FIELD_VERTICES)));
  });

  it('feeds one pool under a body that keeps being hit', () => {
    const model = new BloodFieldModel(256), planner = new BloodMarkPlanner(model);
    planner.setTerrain(terrain());
    for (let i = 0; i < 6; i++) hit(planner, 100, 300, i + 1, i * 250);
    expect(model.countOf(BloodMarkKind.Pool, BloodChannel.Ground) - countBridges(model)).toBe(1);
  });

  it('turns spray at a rock face into rock blood with a pool at its foot', () => {
    const model = new BloodFieldModel(256), planner = new BloodMarkPlanner(model);
    planner.setTerrain(terrain());
    planner.beginHit({ x: 130, y: 16, dirX: 1, dirY: 0, totalDamage: 30, isKill: false, seed: 7, nowMs: 0 });
    const landing = planner.land(130, 16, 230, 16, 0.9, createBloodLanding());
    planner.flight('streak', landing, 130, 16, 0.8, 1, 120);
    planner.endHit();
    expect(model.countOf(undefined, BloodChannel.Rock)).toBeGreaterThan(0);
    expect(model.countOf(BloodMarkKind.Drip, BloodChannel.Rock)).toBe(1);
    // Nothing lands on the ground behind the rock.
    for (let slot = 0; slot < model.count; slot++) {
      const mark = model.mark(slot)!;
      if (mark.channel === BloodChannel.Ground) expect(mark.x).toBeLessThan(170);
    }
  });

  it('dissolves blood landing in water into a cloud and a ripple, never a ground mark', () => {
    const model = new BloodFieldModel(256), planner = new BloodMarkPlanner(model);
    planner.setTerrain(terrain());
    planner.beginHit({ x: 500, y: 300, dirX: 1, dirY: 0, totalDamage: 30, isKill: false, seed: 3, nowMs: 0 });
    const landing = planner.land(500, 300, 540, 300, 0.9, createBloodLanding());
    planner.flight('streak', landing, 500, 300, 0.5, 1, 150);
    planner.endHit();
    expect(model.countOf(undefined, BloodChannel.Ground)).toBe(0);
    expect(model.countOf(BloodMarkKind.Cloud, BloodChannel.Water)).toBeGreaterThan(0);
    expect(planner.ripples.length).toBe(1);
  });

  it('thins out new spatter when the field fills up, so older blood is not pushed out', () => {
    const spatter = (load: number) => {
      const model = new BloodFieldModel(4096), planner = new BloodMarkPlanner(model);
      for (let i = 0; i < 40; i++) {
        planner.beginFrame(i * 100, load);
        planner.beginHit({ x: 600 + i * 50, y: 600, dirX: 1, dirY: 0, totalDamage: 30, isKill: false, seed: i + 1, nowMs: i * 100 });
        for (let k = 0; k < 8; k++) planner.flight('streak', planner.land(600 + i * 50, 600, 640 + i * 50, 600 + k * 3, 0.9, createBloodLanding()), 600 + i * 50, 600, 0.5, 1, 100);
        planner.endHit();
      }
      return model.countOf(BloodMarkKind.Splat);
    };
    expect(spatter(0.95)).toBeLessThan(spatter(0) * 0.6);
  });

  it('limits new spatter per frame in mass fights while pools still grow', () => {
    const model = new BloodFieldModel(4096), planner = new BloodMarkPlanner(model);
    planner.beginFrame(0);
    for (let i = 0; i < 400; i++) {
      planner.beginHit({ x: 600, y: 600, dirX: 1, dirY: 0, totalDamage: 30, isKill: false, seed: i + 1, nowMs: 0 });
      const landing = planner.land(600, 600, 640, 600, 0.9, createBloodLanding());
      planner.flight('droplet', landing, 600, 600, 0.5, 1, 100);
      planner.endHit();
    }
    expect(model.countOf(BloodMarkKind.Splat)).toBeLessThanOrEqual(BLOOD_HIT_VFX.field.admissionPerFrame);
    expect(model.countOf(BloodMarkKind.Pool) - countBridges(model)).toBe(1);
  });
});

/** Connective blobs are small pools laid out along the shot; the main pool is the biggest. */
function countBridges(model: BloodFieldModel): number {
  let bridges = 0;
  for (let slot = 0; slot < model.count; slot++) {
    const mark = model.mark(slot)!;
    if (mark.kind === BloodMarkKind.Pool && mark.r1 < 5) bridges++;
  }
  return bridges;
}
