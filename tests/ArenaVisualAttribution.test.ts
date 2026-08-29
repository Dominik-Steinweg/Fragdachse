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
  setVisible(visible: boolean): void;
  once(): void;
}

interface TypeScriptSource {
  readonly path: string;
  readonly text: string;
}

const VECTOR_FACTORIES = ['graphics', 'circle', 'ellipse', 'rectangle', 'arc', 'line', 'polygon'] as const;
type VectorFactory = (typeof VECTOR_FACTORIES)[number];

/**
 * Nur normale Arena-Runtime-Quellen werden hier automatisch geprüft. Lobby-/Setup-UI bleibt
 * außerhalb des Scopes; einzelne bewusst getrennte Runtime-Systeme sind unten pro Factory
 * dokumentiert, damit kein Directory pauschal ausgenommen wird.
 */
const ARENA_RUNTIME_SOURCE_PREFIXES = [
  'src/arena/',
  'src/effects/',
  'src/entities/',
  'src/powerups/',
  'src/scenes/arena/',
  'src/train/',
] as const;
const ARENA_RUNTIME_SOURCE_NAMES = new Set([
  'src/ui/ArenaHUD.ts',
  'src/ui/CenterHUD.ts',
  'src/ui/CoopDefenseSecondaryObjectiveHud.ts',
  'src/ui/HostileBaseIndicator.ts',
  'src/ui/PlayerStatusRing.ts',
]);

const DIRECT_VECTOR_FACTORY_EXCEPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // AimSystem and AimVisuals render from baked textures; the only remaining Graphics is the AWP
  // charge sweep in AimVisuals.ts. Kept as insurance: `src/ui/` is not in
  // ARENA_RUNTIME_SOURCE_PREFIXES, so this key is currently never read. Should `src/ui/` ever be
  // added there, duplicate this entry for 'src/ui/AimVisuals.ts'.
  'src/ui/AimSystem.ts': Object.fromEntries(VECTOR_FACTORIES.map((factory) => [factory, 'AimSystem renders through AimVisuals and no longer creates vector factories itself.'])),
  'src/entities/BaseEntity.ts:131': { rectangle: 'Invisible Arcade physics hitbox; it never renders.' },
  'src/effects/ShadowSystem.ts:1036': { graphics: 'Invisible RenderTexture bake helper; only the baked texture is rendered.' },
  'src/scenes/arena/EnemyFlowFieldDebugOverlay.ts': { graphics: 'Optional Shift+D+B developer overlay, outside normal arena runtime attribution.' },
  'src/train/TrainManager.ts:324': { rectangle: 'Invisible Arcade physics hitbox kept in the static collision group.' },
};

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
  return /(?:this\.)?(?:sprite\.)?scene\.add\.(?:particles|graphics|circle|ellipse|rectangle|arc|line|polygon)\s*\(/u.test(source.text);
}

function normalizedSourcePath(path: string): string {
  return path.replaceAll('\\', '/').split('/src/').at(-1) ? `src/${path.replaceAll('\\', '/').split('/src/').at(-1)}` : path.replaceAll('\\', '/');
}

function isArenaRuntimeSource(source: TypeScriptSource): boolean {
  const path = normalizedSourcePath(source.path);
  return ARENA_RUNTIME_SOURCE_NAMES.has(path) || ARENA_RUNTIME_SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function factoryReference(source: string, offset: number): string | null {
  const prefix = source.slice(Math.max(0, offset - 800), offset);
  const matches = [...prefix.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=;\n]+)?\s*=|((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\s*=\s*/gu)];
  const match = matches.at(-1);
  return match?.[1] ?? match?.[2] ?? null;
}

function hasConcreteRegistrationForFactory(source: string, offset: number, factory: VectorFactory, family: string): boolean {
  const reference = factoryReference(source, offset);
  if (!reference) return false;
  const following = source.slice(offset, offset + 1000);
  const familyArgument = `(?:['"]${family}['"]|[^,()]*['"]${family}['"][^,()]*)`;
  return new RegExp(
    `registerGraphicsObject\\(\\s*(?:this\\.)?(?:sprite\\.)?scene\\s*,\\s*${familyArgument}\\s*,\\s*${reference.replace('.', '\\.') }\\s*\\)`,
    'u',
  ).test(following);
}

function findUnattributedRuntimeVectorFactories(source: TypeScriptSource, families: Readonly<Record<string, readonly string[]>>): string[] {
  const missing: string[] = [];
  const sourcePath = normalizedSourcePath(source.path);
  const sourceName = sourcePath.split('/').at(-1)!.replace(/\.ts$/u, '');
  const sourceFamilies = Object.entries(families)
    .filter(([, sourceNames]) => sourceNames.includes(sourceName))
    .map(([family]) => family);
  const factoryPattern = /(?:this\.)?(?:sprite\.)?scene\.add\.(graphics|circle|ellipse|rectangle|arc|line|polygon)\s*\(/gu;

  for (const match of source.text.matchAll(factoryPattern)) {
    const offset = match.index ?? 0;
    const factory = match[1] as VectorFactory;
    const line = lineNumberAt(source.text, offset);
    const exception = DIRECT_VECTOR_FACTORY_EXCEPTIONS[`${sourcePath}:${line}`]?.[factory]
      ?? DIRECT_VECTOR_FACTORY_EXCEPTIONS[sourcePath]?.[factory];
    if (exception) continue;
    if (!sourceFamilies.length) {
      missing.push(`${sourcePath}:${line} ${factory} (source is missing from GRAPHICS_FAMILIES)`);
      continue;
    }
    if (!sourceFamilies.some((family) => hasConcreteRegistrationForFactory(source.text, offset, factory, family))) {
      missing.push(`${sourcePath}:${line} ${factory} (${factoryReference(source.text, offset) ?? 'unbound factory'})`);
    }
  }
  return missing;
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
  const value: FakeGraphics = {
    active,
    visible: active,
    setVisible: (visible: boolean) => { value.visible = visible; },
    once: () => undefined,
  };
  return value as unknown as Phaser.GameObjects.GameObject;
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
    collector.registerParticleEmitter('playerStealth', inactive);
    collector.registerParticleEmitter('asmdPrimary', active);
    collector.setActive(true);
    collector.setRecording(true);
    collector.recordParticleSpawn('asmdPrimary', 12);

    const snapshot = collector.sampleAndReset();

    expect(snapshot.particleFamilies.playerStealth).toEqual({
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

  it('keeps the trace blind spots on concrete object registrations', () => {
    const sources = readTypeScriptSources(resolve(process.cwd(), 'src'));
    const expected = [
      ['PowerUpRenderer', 'powerUpEffects', ['graphic']],
      ['ArenaVisualFactory', 'treeTrunks', ['trunk']],
      ['ProjectileManager', 'projectileShapes', ['sprite']],
      ['EnemyEntity', 'enemyStatus', ['ring', 'this.voidMolotovWindupRing']],
    ] as const;
    for (const [sourceName, family, objects] of expected) {
      const source = sources.find((candidate) => sourceDeclaresClass(candidate, sourceName));
      expect(source, sourceName).toBeDefined();
      for (const object of objects) {
        expect(
          source?.text,
          `${sourceName}.${object} -> ${family}`,
        ).toMatch(new RegExp(
          `registerGraphicsObject\\(\\s*(?:this\\.)?(?:sprite\\.)?scene\\s*,\\s*['"]${family}['"]\\s*,\\s*${object.replace('.', '\\.') }\\s*\\)`,
          'u',
        ));
      }
    }
  });

  it('reports graphics creation and destruction churn in interval and recording data', () => {
    const collector = new ArenaVisualAttributionCollector();
    collector.setActive(true);
    collector.setRecording(true);
    const object = graphics(true);
    const unregister = collector.registerGraphicsObject('powerUpEffects', object);

    expect(collector.sampleAndReset().interval?.graphicsWork?.powerUpEffects).toEqual({ createdObjects: 1 });
    unregister();
    expect(collector.sampleAndReset().interval?.graphicsWork?.powerUpEffects).toEqual({ destroyedObjects: 1 });
    expect(collector.getRecordingSummary().graphicsWork.powerUpEffects).toEqual({
      createdObjects: 1,
      destroyedObjects: 1,
    });
  });

  it('suppresses and restores only the registered vector family', () => {
    const collector = new ArenaVisualAttributionCollector();
    const object = graphics(true);
    collector.setActive(true);
    collector.registerGraphicsObject('treeTrunks', object);
    collector.setGraphicsFamilySuppressed('treeTrunks', true);
    expect(object.visible).toBe(false);
    collector.setGraphicsFamilySuppressed('treeTrunks', false);
    expect(object.visible).toBe(true);
    collector.setGraphicsFamilySuppressed('treeTrunks', true);
    collector.setActive(false);
    expect(object.visible).toBe(true);
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

    for (const source of sources) {
      if (!isArenaRuntimeSource(source) || !sourceHasDirectPhaserFactory(source)) continue;
      expect(
        findUnattributedRuntimeVectorFactories(source, GRAPHICS_FAMILIES),
        `every direct renderable Vector factory in ${normalizedSourcePath(source.path)} must have object-level attribution`,
      ).toEqual([]);
    }

    const effectSystem = sources.find((source) => sourceDeclaresClass(source, 'EffectSystem'));
    expect(effectSystem, 'EffectSystem source').toBeDefined();
    if (effectSystem) {
      expect(
        findUnattributedEffectSystemGraphicsFactories(effectSystem.text),
        'every direct EffectSystem Runtime-Graphics factory must have its own hook',
      ).toEqual([]);
      // Strukturierte Koerper/Ringe leben im GPU-Manifest. Als spezialisiertes Nuke-GameObject
      // verbleibt nur der choreografierte Vollbildblitz in der Vector-Attribution.
      expect(effectSystem.text).toMatch(/spawnCombatExplosionGpu\(x, y, radius, visualStyle/u);
      expect(effectSystem.text).toMatch(
        /registerGraphicsObject\(\s*this\.scene\s*,\s*'nukeTelegraphs'\s*,\s*skyFlash\s*\)/u,
      );
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

/**
 * `Graphics.strokeCircle`, `fillCircle` und `arc` erzeugen im WebGL-Renderer rund 101 Punkte pro
 * Bogen, unabhaengig vom Radius, und werden in jedem gezeichneten Frame neu tesseliert. Diese
 * Liste ist eine Ratsche: bestehende Systeme duerfen bleiben, neue Dateien nicht dazukommen, und
 * ein umgestelltes System muss seinen Eintrag wieder verlieren. Begruendung siehe
 * `docs/ai/performance.md`.
 */
const GRAPHICS_ARC_LEGACY_SOURCES: Readonly<Record<string, string>> = {
  'src/effects/Ak47StrategicTargetRenderer.ts': 'Zielmarkierung, noch nicht auf gebackene Ringe umgestellt.',
  'src/effects/BfgRenderer.ts': 'Strahlendpunkte, noch nicht auf gebackene Glowquads umgestellt.',
  'src/effects/CaptureTheBeerRenderer.ts': 'Flaschensymbol, noch nicht auf eine gebackene Textur umgestellt.',
  'src/effects/CoopDefenseSecondaryObjectiveMarkerRenderer.ts': 'Markerringe, noch nicht auf gebackene Ringe umgestellt.',
  'src/effects/EffectSystem.ts': 'Explosions- und Kegelgeometrie, noch nicht umgestellt.',
  'src/effects/EnergyShieldRenderer.ts': 'Schildkuppel mit dynamischen Teilbogen, noch nicht umgestellt.',
  'src/effects/PlasmaBurnerRenderer.ts': 'Strahlendpunkt, noch nicht auf ein gebackenes Glowquad umgestellt.',
  'src/effects/ShadowSystem.ts': 'Einmaliger Bake in eine RenderTexture, kein Pro-Frame-Pfad.',
  'src/effects/StinkCloudSystem.ts': 'Wolkenringe, noch nicht auf gebackene Ringe umgestellt.',
  'src/effects/TeslaDomeRenderer.ts': 'Feldfilamente mit dynamischen Teilbogen, noch nicht umgestellt.',
  'src/effects/ZeusTaserRenderer.ts': 'Kegeltelegraph, noch nicht umgestellt.',
  'src/entities/BaseEntity.ts': 'Einmalig gezeichnete Basismarkierung, kein Pro-Frame-Pfad.',
  'src/scenes/arena/GaussWarningRenderer.ts': 'Emitterglow der Fremdspieler, noch nicht umgestellt.',
  'src/scenes/arena/PlacementPreviewRenderer.ts': 'Platzierungsvorschau, noch nicht umgestellt.',
  'src/scenes/arena/RockVisualHelper.ts': 'Reichweitenkreis, noch nicht umgestellt.',
  'src/ui/CoopDefenseObjectiveAnnouncement.ts': 'Einmalig gezeichneter Rahmenschmuck, kein Pro-Frame-Pfad.',
  'src/ui/HostileBaseIndicator.ts': 'Pfeilspitze, noch nicht umgestellt.',
  'src/ui/RadialActionMenu.ts': 'Radialmenue, zeichnet nur bei geoeffnetem Menue.',
};

/** `ctx`/`context` sind der Canvas-2D-Kontext beim Backen und damit ausdruecklich erlaubt. */
const CANVAS_CONTEXT_RECEIVERS = new Set(['ctx', 'context']);

function findGraphicsArcCalls(source: TypeScriptSource): number[] {
  const pattern = /([A-Za-z_$][\w$]*)\s*\.\s*(?:strokeCircle|fillCircle|arc)\s*\(/gu;
  const lines: number[] = [];

  for (const match of source.text.matchAll(pattern)) {
    if (CANVAS_CONTEXT_RECEIVERS.has(match[1])) continue;

    const offset = match.index ?? 0;
    const lineStart = source.text.lastIndexOf('\n', offset) + 1;
    const prefix = source.text.slice(lineStart, offset);
    // Kommentare zaehlen nicht: Zeilenkommentar davor oder JSDoc-Fortsetzungszeile.
    if (prefix.includes('//') || /^\s*\*/u.test(prefix)) continue;

    lines.push(lineNumberAt(source.text, offset));
  }
  return lines;
}

describe('Graphics arc guardrail', () => {
  it('keeps new sources free of per-frame Graphics arcs', () => {
    const sources = readTypeScriptSources(resolve(process.cwd(), 'src'));
    const offenders = sources
      .map((source) => ({ path: normalizedSourcePath(source.path), lines: findGraphicsArcCalls(source) }))
      .filter((entry) => entry.lines.length > 0 && !(entry.path in GRAPHICS_ARC_LEGACY_SOURCES))
      .map((entry) => `${entry.path}:${entry.lines.join(',')}`);

    expect(offenders).toEqual([]);
  });

  it('keeps the legacy list a ratchet without stale entries', () => {
    const sources = readTypeScriptSources(resolve(process.cwd(), 'src'));
    const withArcs = new Set(
      sources
        .filter((source) => findGraphicsArcCalls(source).length > 0)
        .map((source) => normalizedSourcePath(source.path)),
    );
    const stale = Object.keys(GRAPHICS_ARC_LEGACY_SOURCES).filter((path) => !withArcs.has(path));

    expect(stale).toEqual([]);
  });
});
