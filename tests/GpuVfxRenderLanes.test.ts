import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));

import { GPU_VFX_ATLAS, GpuVfxFrameId } from '../src/effects/gpu/GpuVfxAtlas';
import { GPU_VFX_EFFECTS } from '../src/effects/gpu/GpuVfxEffects';
import { GPU_VFX_LANES, GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import { DEPTH } from '../src/config';

/** Die layerglobalen Eigenschaften – nur sie duerfen eine eigene Lane rechtfertigen. */
function laneKey(lane: (typeof GPU_VFX_LANES)[number]): string {
  return [lane.depth, lane.blendMode, lane.gravity ?? 'default', [...lane.eases].sort().join('+')].join('|');
}

describe('gpu vfx render lanes', () => {
  it('keeps the manifest index in sync with the lane id', () => {
    GPU_VFX_LANES.forEach((lane, index) => expect(lane.id).toBe(index));
    expect(new Set(GPU_VFX_LANES.map((lane) => lane.label)).size).toBe(GPU_VFX_LANES.length);
  });

  it('justifies every physical lane by a real incompatibility', () => {
    // Zwei Lanes mit identischen layerglobalen Eigenschaften waeren eine Lane zu viel: alles
    // andere (Position, Frame, Rotation, Scale, Alpha, Tint, Lebenszeit) gilt pro Member.
    const seen = new Map<string, string>();
    for (const lane of GPU_VFX_LANES) {
      const key = laneKey(lane);
      const previous = seen.get(key);
      expect(previous, `${lane.label} ist von ${previous} nicht unterscheidbar`).toBeUndefined();
      seen.set(key, lane.label);
    }
  });

  it('demands a rationale and a capacity derivation from every lane', () => {
    for (const lane of GPU_VFX_LANES) {
      expect(lane.rationale.length, lane.label).toBeGreaterThan(40);
      expect(lane.capacityRationale.length, lane.label).toBeGreaterThan(40);
      expect(lane.capacity).toBeGreaterThan(0);
      expect(lane.maxLifetimeMs).toBeGreaterThan(0);
    }
  });

  it('only calls a lane order-independent when it blends additively', () => {
    // `add-over-opaque` ist eine Ortsbedingung: Phasers ADD ist `[ONE, DST_ALPHA, ...]` und nur
    // dort kommutativ, wo `dstAlpha` bereits gesaettigt ist.
    for (const lane of GPU_VFX_LANES) {
      if (lane.order === 'add-over-opaque') expect(lane.blendMode).toBe(1);
      // NORMAL-Lanes sind reihenfolgeabhaengig und muessen es auch so deklarieren.
      if (lane.blendMode === 0) expect(lane.order).toBe('ordered');
    }
  });

  it('shares one lane between compatible effects and splits incompatible ones', () => {
    const effect = (label: string) => GPU_VFX_EFFECTS.find((candidate) => candidate.label === label)!;

    // Geteilt: accent und edge sind additiv im selben Tiefenband.
    expect(effect('stink.accent').lane).toBe(GpuVfxLaneId.StinkAdd);
    expect(effect('stink.edge').lane).toBe(GpuVfxLaneId.StinkAdd);
    // Derselbe Effekt darf je Variante die Lane wechseln – der Blend-Mode ist layerglobal.
    expect(effect('stink.inner').lane).toBe(GpuVfxLaneId.StinkNormal);
    expect(effect('stink.inner').laneAdditive).toBe(GpuVfxLaneId.StinkAdd);

    // Getrennt trotz gleichem Blend: zwischen den Airstrike-Lanes liegen die CPU-Spieler, und
    // `gravity` ist layerglobal.
    const bomb = GPU_VFX_LANES[GpuVfxLaneId.AirstrikeBomb];
    const spark = GPU_VFX_LANES[GpuVfxLaneId.AirstrikeSpark];
    expect(bomb.blendMode).toBe(spark.blendMode);
    expect(bomb.depth).not.toBe(spark.depth);
    expect(bomb.gravity).toBe(30);
    expect(spark.gravity).toBeUndefined();

    // Getrennt wegen des Blend-Modes.
    expect(GPU_VFX_LANES[GpuVfxLaneId.StinkNormal].blendMode)
      .not.toBe(GPU_VFX_LANES[GpuVfxLaneId.StinkAdd].blendMode);
  });

  it('never grows the lane count with the effect count', () => {
    // Der eigentliche Architekturvertrag: 23 logische Effekte auf 14 physischen Lanes.
    expect(GPU_VFX_EFFECTS.length).toBeGreaterThan(GPU_VFX_LANES.length);
    expect(GPU_VFX_LANES.length).toBe(14);
  });

  it('keeps leaf debris in an explicit ordered world lane', () => {
    const lane = GPU_VFX_LANES[GpuVfxLaneId.WorldDebris];
    const effect = GPU_VFX_EFFECTS.find((candidate) => candidate.label === 'leaf.debris')!;
    const dust = GPU_VFX_EFFECTS.find((candidate) => candidate.label === 'leafblower.dust')!;

    expect(lane.depth).toBe(DEPTH.FIRE + 0.075);
    expect(lane.depth).toBeGreaterThan(DEPTH.FIRE + 0.05);
    expect(lane.depth).toBeLessThan(DEPTH.FIRE + 0.1);
    expect(lane.blendMode).toBe(0);
    expect(lane.order).toBe('ordered');
    expect(lane.capacity).toBe(2048);
    expect(lane.maxLifetimeMs).toBe(860);
    expect(effect.lane).toBe(GpuVfxLaneId.WorldDebris);
    expect(effect.frame).toBe(GpuVfxFrameId.LeafDebris);
    expect(effect.release).toBe('linger');
    expect(dust.lane).toBe(GpuVfxLaneId.WorldDebris);
    expect(dust.frame).toBe(GpuVfxFrameId.LeafBlowerDust);
    expect(dust.release).toBe('linger');
    expect(lane.capacityRationale).toContain('Staub');
  });

  it('keeps the migrated fire families on one lane per depth band', () => {
    const groundFire = GPU_VFX_LANES[GpuVfxLaneId.GroundFire];
    const groundSmoke = GPU_VFX_LANES[GpuVfxLaneId.GroundFireSmoke];
    const entityBurn = GPU_VFX_LANES[GpuVfxLaneId.EntityBurn];
    const projectileBurn = GPU_VFX_LANES[GpuVfxLaneId.ProjectileBurn];

    // Bodenfeuer liegt zwischen Felsvegetation und Spielern, der Rauch darunter.
    expect(groundFire.depth).toBe(DEPTH.ROCKS + 0.2);
    expect(groundSmoke.depth).toBe(DEPTH.ROCKS + 0.12);
    expect(groundSmoke.depth).toBeLessThan(groundFire.depth);
    expect(groundFire.depth).toBeLessThan(DEPTH.PLAYERS);
    // Der Rauch ist der einzige nicht-additive Teil und deshalb eine eigene Lane.
    expect(groundSmoke.blendMode).toBe(0);
    expect(groundFire.blendMode).toBe(1);

    expect(entityBurn.depth).toBe(DEPTH.PLAYERS + 0.23);
    expect(projectileBurn.depth).toBe(DEPTH.PROJECTILES + 0.34);

    // Jede Lane deklariert die *staerkste* Beschleunigung ihrer Bewohner.
    expect(groundFire.gravity).toBe(-36);
    expect(entityBurn.gravity).toBe(-34);
    expect(projectileBurn.gravity).toBe(-30);
    expect(groundSmoke.gravity).toBeUndefined();

    expect(groundFire.capacity).toBe(1536);
    expect(groundSmoke.capacity).toBe(128);
    expect(entityBurn.capacity).toBe(2048);
    expect(projectileBurn.capacity).toBe(2048);
  });

  it('lets effects with different accelerations share one lane', () => {
    const effect = (label: string) => GPU_VFX_EFFECTS.find((candidate) => candidate.label === label)!;

    // Frueher haetten outer (-10), core (-18) und spark (-36) drei Lanes erzwungen. Der Shader
    // rechnet `uGravity * gravityFactor`, und `gravityFactor` liegt pro Member – die drei teilen
    // sich deshalb eine Lane und skalieren die Lane-Gravity von -36 herunter.
    expect(effect('groundfire.outer').lane).toBe(GpuVfxLaneId.GroundFire);
    expect(effect('groundfire.core').lane).toBe(GpuVfxLaneId.GroundFire);
    expect(effect('groundfire.spark').lane).toBe(GpuVfxLaneId.GroundFire);
    expect(effect('groundfire.smoke').lane).toBe(GpuVfxLaneId.GroundFireSmoke);

    expect(effect('projburn.outer').lane).toBe(GpuVfxLaneId.ProjectileBurn);
    expect(effect('projburn.core').lane).toBe(GpuVfxLaneId.ProjectileBurn);
    expect(effect('projburn.spark').lane).toBe(GpuVfxLaneId.ProjectileBurn);

    expect(effect('entityburn.core').lane).toBe(GpuVfxLaneId.EntityBurn);
    expect(effect('entityburn.outer').lane).toBe(GpuVfxLaneId.EntityBurn);
    expect(effect('entityburn.spark').lane).toBe(GpuVfxLaneId.EntityBurn);
  });

  it('uses the white FlameJet primitives for GroundFire and keeps other fire effects stable', () => {
    // GroundFire nutzt die tintbaren Jet-Motive; Trails und EntityBurn behalten ihre bisherigen
    // Frames. Alle Motive liegen bereits im gemeinsamen Atlas.
    const flameFrames = new Set<number>([
      GpuVfxFrameId.FlameCore, GpuVfxFrameId.FlameOuter, GpuVfxFrameId.FlameSpark,
    ]);
    for (const label of ['projburn.outer', 'projburn.core', 'projburn.spark',
      'entityburn.core', 'entityburn.outer', 'entityburn.spark']) {
      const effect = GPU_VFX_EFFECTS.find((candidate) => candidate.label === label)!;
      expect(flameFrames.has(effect.frame), label).toBe(true);
    }
    expect(GPU_VFX_EFFECTS.find((candidate) => candidate.label === 'groundfire.outer')!.frame)
      .toBe(GpuVfxFrameId.FlameBillow);
    expect(GPU_VFX_EFFECTS.find((candidate) => candidate.label === 'groundfire.core')!.frame)
      .toBe(GpuVfxFrameId.FlameTongue);
    expect(GPU_VFX_EFFECTS.find((candidate) => candidate.label === 'groundfire.spark')!.frame)
      .toBe(GpuVfxFrameId.FlameSpark);
    expect(GPU_VFX_EFFECTS.find((candidate) => candidate.label === 'groundfire.smoke')!.frame)
      .toBe(GpuVfxFrameId.GroundFireSmoke);
  });

  it('keeps flame depth, blend, gravity and derived capacities stable', () => {
    const outer = GPU_VFX_LANES[GpuVfxLaneId.FlameOuter];
    const core = GPU_VFX_LANES[GpuVfxLaneId.FlameCore];
    const spark = GPU_VFX_LANES[GpuVfxLaneId.FlameSpark];

    expect(outer.blendMode).toBe(1);
    expect(outer.depth).toBe(DEPTH.FIRE);
    expect(core.depth).toBe(DEPTH.FIRE + 0.05);
    expect(spark.depth).toBe(DEPTH.FIRE + 0.1);
    expect(spark.gravity).toBe(-30);
    expect(spark.eases).toEqual([0, 2]);
    expect(outer.capacity).toBe(3072);
    expect(core.capacity).toBe(2304);
    expect(spark.capacity).toBe(512);
  });

  it('keeps every effect pointing at an existing lane and atlas frame', () => {
    const frameIds = new Set<number>(GPU_VFX_ATLAS.map((entry) => entry.id));
    for (const effect of GPU_VFX_EFFECTS) {
      expect(GPU_VFX_LANES[effect.lane]).toBeDefined();
      if (effect.laneAdditive !== undefined) expect(GPU_VFX_LANES[effect.laneAdditive]).toBeDefined();
      expect(frameIds.has(effect.frame)).toBe(true);
      // `__void` ist der unsichtbare Platzhalter und darf nie das Motiv eines Effekts sein.
      expect(effect.frame).not.toBe(GpuVfxFrameId.Void);
    }
  });

  it('lets every effect stay identifiable on a shared lane', () => {
    expect(new Set(GPU_VFX_EFFECTS.map((effect) => effect.label)).size).toBe(GPU_VFX_EFFECTS.length);
    GPU_VFX_EFFECTS.forEach((effect, index) => expect(effect.id).toBe(index));
  });
});
