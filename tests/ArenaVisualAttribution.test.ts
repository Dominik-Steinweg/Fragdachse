import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

interface TypeScriptSource {
  readonly path: string;
  readonly text: string;
}

function readTypeScriptSources(directory: string): TypeScriptSource[] {
  const sources: TypeScriptSource[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      sources.push(...readTypeScriptSources(path));
    } else if (path.endsWith('.ts') && !path.endsWith('ArenaVisualAttribution.ts')) {
      sources.push({ path, text: readFileSync(path, 'utf8') });
    }
  }
  return sources;
}

function hasHookForFamily(source: string, family: string, hooks: readonly string[]): boolean {
  const literal = `'${family}'`;
  let offset = 0;
  while (true) {
    const familyOffset = source.indexOf(literal, offset);
    if (familyOffset < 0) break;
    const statementStart = source.lastIndexOf(';', familyOffset) + 1;
    const statement = source.slice(statementStart, familyOffset + literal.length);
    if (hooks.some((hook) => new RegExp(`${hook}\\s*\\(`).test(statement))) return true;
    offset = familyOffset + literal.length;
  }
  return false;
}

function sourceDeclaresClass(source: TypeScriptSource, className: string): boolean {
  return new RegExp(`\\bclass\\s+${className}\\b`).test(source.text);
}

function sourceHasDirectPhaserFactory(source: TypeScriptSource): boolean {
  return /(?:this\.)?scene\.add\.(?:particles|graphics|circle|ellipse|rectangle|arc|line|polygon)\s*\(/u.test(source.text);
}

function findUnattributedEffectSystemGraphicsFactories(source: string): string[] {
  const factoryPattern = /this\.scene\.add\.(graphics|circle|ellipse|rectangle|arc|line|polygon)\s*\(/gu;
  const missing: string[] = [];

  for (const match of source.matchAll(factoryPattern)) {
    const offset = match.index ?? 0;
    const statementStart = source.lastIndexOf(';', offset) + 1;
    const statementEnd = source.indexOf(';', offset);
    const end = statementEnd >= 0 ? statementEnd + 1 : source.length;
    const statement = source.slice(statementStart, end);
    const variable = statement.match(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/u)?.[1];
    if (!variable) {
      missing.push(`${match[1]}@${offset}`);
      continue;
    }

    const registration = new RegExp(
      `registerGraphicsObject\\(\\s*this\\.scene\\s*,\\s*(?:'effectSystemGraphics'|'nukeTelegraphs'|isNuke\\s*\\?\\s*'nukeTelegraphs'\\s*:\\s*'effectSystemGraphics')\\s*,\\s*${variable}\\s*\\)`,
      'u',
    );
    const following = source.slice(end, end + 320);
    if (!registration.test(statement) && !registration.test(following)) {
      missing.push(`${variable} (${match[1]})`);
    }
  }

  return missing;
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

  it('requires every catalog family to have a concrete runtime attribution hook', () => {
    const sources = readTypeScriptSources(resolve(process.cwd(), 'src'));
    const particleHooks = ['registerParticleEmitter', 'createEmitter', 'createQualityEmitter'];
    const graphicsHooks = ['registerGraphicsObject', 'recordGraphicsWork', 'setGraphicsGauge'];

    for (const [family, sourceNames] of Object.entries(CLASSIC_PARTICLE_FAMILIES)) {
      for (const sourceName of sourceNames) {
        const source = sources.find((candidate) => sourceDeclaresClass(candidate, sourceName));
        expect(source, `classic source ${sourceName} for ${family}`).toBeDefined();
        expect(
          source && hasHookForFamily(source.text, family, particleHooks),
          `classic hook ${family} in ${sourceName}`,
        ).toBe(true);
      }
    }

    for (const [family, sourceNames] of Object.entries(GRAPHICS_FAMILIES)) {
      for (const sourceName of sourceNames) {
        const source = sources.find((candidate) => sourceDeclaresClass(candidate, sourceName));
        expect(source, `graphics source ${sourceName} for ${family}`).toBeDefined();
        expect(
          source && hasHookForFamily(source.text, family, graphicsHooks),
          `graphics hook ${family} in ${sourceName}`,
        ).toBe(true);
      }
    }

    const catalogSourceNames = new Set([
      ...Object.values(CLASSIC_PARTICLE_FAMILIES).flat(),
      ...Object.values(GRAPHICS_FAMILIES).flat(),
    ]);
    for (const source of sources) {
      if (!sourceHasDirectPhaserFactory(source)) continue;
      const sourceFamilies = [
        ...Object.entries(CLASSIC_PARTICLE_FAMILIES)
          .filter(([, sourceNames]) => sourceNames.includes(source.path.split(/[\\/]/u).pop()!.replace(/\.ts$/u, '') as never)),
        ...Object.entries(GRAPHICS_FAMILIES)
          .filter(([, sourceNames]) => sourceNames.includes(source.path.split(/[\\/]/u).pop()!.replace(/\.ts$/u, '') as never)),
      ];
      if (!sourceFamilies.length || !catalogSourceNames.has(source.path.split(/[\\/]/u).pop()!.replace(/\.ts$/u, ''))) continue;
      expect(
        sourceFamilies.some(([family]) => hasHookForFamily(source.text, family, [...particleHooks, ...graphicsHooks])),
        `direct Phaser factory attribution in ${source.path}`,
      ).toBe(true);
    }

    const effectSystem = sources.find((source) => sourceDeclaresClass(source, 'EffectSystem'));
    expect(effectSystem, 'EffectSystem source').toBeDefined();
    if (effectSystem) {
      expect(
        findUnattributedEffectSystemGraphicsFactories(effectSystem.text),
        'every direct EffectSystem Runtime-Graphics factory must have its own hook',
      ).toEqual([]);
      expect(effectSystem.text).toMatch(
        /registerGraphicsObject\(\s*this\.scene\s*,\s*isNuke\s*\?\s*'nukeTelegraphs'\s*:\s*'effectSystemGraphics'\s*,\s*halo\s*\)/u,
      );
      expect(effectSystem.text).toMatch(
        /registerGraphicsObject\(\s*this\.scene\s*,\s*isNuke\s*\?\s*'nukeTelegraphs'\s*:\s*'effectSystemGraphics'\s*,\s*blast\s*\)/u,
      );
      for (const objectName of ['skyFlash', 'secondaryBlast', 'heatHalo', 'shockRingA', 'shockRingB']) {
        expect(
          effectSystem.text,
          `nuke graphics hook for EffectSystem.${objectName}`,
        ).toMatch(new RegExp(
          `registerGraphicsObject\\(\\s*this\\.scene\\s*,\\s*'nukeTelegraphs'\\s*,\\s*${objectName}\\s*\\)`,
          'u',
        ));
      }
    }
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
