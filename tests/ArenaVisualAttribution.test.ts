import type * as Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import {
  ArenaVisualAttributionCollector,
  CLASSIC_PARTICLE_FAMILIES,
  GRAPHICS_FAMILIES,
  MAX_ATTRIBUTION_FAMILIES,
} from '../src/scenes/arena/ArenaVisualAttribution';
import {
  ArenaRuntimeProfiler,
  type ArenaRuntimeSample,
} from '../src/scenes/arena/ArenaRuntimeProfiler';

interface FakeEmitter {
  active: boolean;
  alive: number;
  getAliveParticleCount(): number;
  once(): void;
}

interface FakeGraphics {
  active: boolean;
  visible: boolean;
  once(): void;
}

function emitter(active = false, alive = 0): Phaser.GameObjects.Particles.ParticleEmitter {
  const value: FakeEmitter = {
    active,
    alive,
    getAliveParticleCount: () => value.alive,
    once: () => undefined,
  };
  return value as unknown as Phaser.GameObjects.Particles.ParticleEmitter;
}

function graphics(active = false): Phaser.GameObjects.GameObject {
  return {
    active,
    visible: active,
    once: () => undefined,
  } as unknown as Phaser.GameObjects.GameObject;
}

function sample(): ArenaRuntimeSample {
  return {
    role: 'host',
    phase: 'arena',
    quality: 'high',
    mode: 'standard',
    mapId: 'test-map',
    ablation: 'baseline',
    rawDeltaMs: 16,
    deltaMs: 16,
    updateMs: 1,
    gameStepMs: 16,
    phaserSceneUpdateMs: 0,
    phaserSceneSystemsMs: 0,
    rendererSetupMs: 0,
    betweenFramesMs: 0,
    renderSubmitMs: 0,
    roleStepMs: 1,
    networkUpdateMs: 0,
    networkFlushMs: 0,
    visualStepMs: 0,
    visualCameraMs: 0,
    visualEnemyMs: 0,
    visualEffectsMs: 0,
    visualAimMs: 0,
    visualHudMs: 0,
    shadowStepMs: 0,
    lightingStepMs: 0,
    fireSimulationMs: 0,
    fireCreationMs: 0,
    fireVisualMs: 0,
    enemyCount: 0,
    projectileCount: 0,
    playerCount: 1,
    displayObjectCount: 0,
    visibleObjectCount: 0,
    particleEmitterCount: 0,
    aliveParticleCount: 0,
    activeFilterCount: 0,
    activeLightCount: 0,
    renderedLightCount: 0,
    drawCallCount: 0,
  };
}

describe('ArenaVisualAttributionCollector', () => {
  it('keeps existing but inactive emitters and separates known spawns into interval data', () => {
    const collector = new ArenaVisualAttributionCollector();
    const inactive = emitter(false, 0);
    const active = emitter(true, 7);
    collector.registerParticleEmitter('playerStatusRing', inactive);
    collector.registerParticleEmitter('asmdPrimary', active);
    collector.setActive(true);
    collector.setRecording(true);
    collector.recordParticleSpawn('asmdPrimary', 12);

    const snapshot = collector.sampleAndReset();

    expect(snapshot.particleFamilies.playerStatusRing).toEqual({
      emitterCount: 1,
      activeEmitterCount: 0,
      aliveParticles: 0,
    });
    expect(snapshot.particleFamilies.asmdPrimary).toEqual({
      emitterCount: 1,
      activeEmitterCount: 1,
      aliveParticles: 7,
    });
    expect(snapshot.interval?.particleSpawns).toEqual({ asmdPrimary: 12 });
    expect(snapshot.particleFamilies.asmdPrimary).not.toHaveProperty('spawnedParticles');
  });

  it('enforces single-family ownership while allowing idempotent registration', () => {
    const collector = new ArenaVisualAttributionCollector();
    const value = emitter();

    const first = collector.registerParticleEmitter('bullet', value);
    const second = collector.registerParticleEmitter('bullet', value);

    expect(second).toBe(first);
    expect(() => collector.registerParticleEmitter('gauss', value)).toThrow(/bullet/);
  });

  it('keeps persistent graphics objects visible without current redraw work', () => {
    const collector = new ArenaVisualAttributionCollector();
    collector.registerGraphicsObject('spawnRings', graphics(false));
    collector.setActive(true);

    expect(collector.sampleAndReset().graphicsFamilies.spawnRings).toEqual({ objectCount: 1 });
    expect(collector.sampleAndReset().graphicsFamilies.spawnRings).toEqual({ objectCount: 1 });
    expect(collector.sampleAndReset().graphicsFamilies.lightingOcclusion).toBeUndefined();
  });

  it('keeps the new-family limit separate from the authoritative GPU manifest', () => {
    expect(Object.keys(CLASSIC_PARTICLE_FAMILIES).length + Object.keys(GRAPHICS_FAMILIES).length)
      .toBeLessThanOrEqual(MAX_ATTRIBUTION_FAMILIES);
    expect(new ArenaVisualAttributionCollector().getCatalog().gpuVfxCatalogRef).toBe('GPU_VFX_EFFECTS');
  });
});

describe('ArenaRuntimeProfiler attribution freeze', () => {
  it('keeps recording series and summaries stable after stop while live HUD continues', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const profiler = new ArenaRuntimeProfiler();
    const collector = new ArenaVisualAttributionCollector();
    const value = emitter(false, 0);
    collector.registerParticleEmitter('asmdPrimary', value);
    profiler.setAttributionSource(collector);

    profiler.startRecording();
    collector.recordParticleSpawn('asmdPrimary', 5);
    profiler.record(sample());
    now = 400;
    profiler.stopRecording();

    const reportA = profiler.buildReport();
    const frozen = {
      series: reportA?.series,
      summaries: reportA?.summaries,
      events: reportA?.events,
      attributionCatalog: reportA?.attributionCatalog,
    };

    profiler.setLiveDiagnosticsEnabled(true);
    value.active = true;
    value.alive = 30;
    for (let index = 0; index < 20; index += 1) {
      now += 100;
      collector.recordParticleSpawn('asmdPrimary', 9);
      profiler.record(sample());
    }

    const reportB = profiler.buildReport();
    expect({
      series: reportB?.series,
      summaries: reportB?.summaries,
      events: reportB?.events,
      attributionCatalog: reportB?.attributionCatalog,
    }).toEqual(frozen);
  });
});
