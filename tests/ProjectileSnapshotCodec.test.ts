import { describe, expect, it } from 'vitest';
import {
  EMPTY_FULL_PROJECTILE_SNAPSHOT,
  PROJECTILE_STYLES,
  applyProjectileSnapshot,
  countProjectileDynamics,
  decodeProjectileDynamics,
  decodeProjectileStatics,
  encodeProjectileDynamic,
  encodeProjectileStatic,
} from '../src/network/projectileSnapshotCodec';
import type {
  SyncedProjectileDynamic,
  SyncedProjectileSnapshot,
  SyncedProjectileStatic,
} from '../src/types';

function roundTripStatic(entry: SyncedProjectileStatic): SyncedProjectileStatic {
  const stream: Array<number | string> = [];
  encodeProjectileStatic(stream, entry);
  const decoded = decodeProjectileStatics(stream);
  expect(decoded).toHaveLength(1);
  return decoded[0];
}

function roundTripDynamic(entry: SyncedProjectileDynamic): SyncedProjectileDynamic {
  const stream: Array<number | string> = [];
  encodeProjectileDynamic(stream, entry);
  const decoded = decodeProjectileDynamics(stream);
  expect(decoded).toHaveLength(1);
  return decoded[0];
}

describe('Projektil-Statik-Codec', () => {
  it('round-trips a fully populated static entry including every optional tracer field', () => {
    const entry: SyncedProjectileStatic = {
      id: 4711,
      ownerId: 'peer-abc-123',
      color: 0xffcc00,
      allowTeamDamage: true,
      ownerColor: 0xff0000,
      visualMuzzleOrigin: { x: 1230.5, y: 570.25 },
      projectileVisualScale: 1.4,
      smokeTrailColor: 0x336699,
      style: 'rocket',
      sporeVisualVariant: 'spore_void',
      bulletVisualPreset: 'ak47',
      grenadeVisualPreset: 'molotov',
      energyBallVariant: 'plasma',
      velocityDecay: 0.82,
      tracer: {
        widthCore: 1.5,
        widthGlow: 4,
        alphaCore: 0.75,
        alphaGlow: 0.22,
        segments: 5,
        fadeMs: 220,
        maxLength: 150,
        colorCore: 0xffffff,
        colorGlow: 0xffcc00,
      },
      shotAudioKey: 'ak47',
      suppressSpawnFx: true,
    };
    expect(roundTripStatic(entry)).toEqual(entry);
  });

  it('keeps every unset field undefined - a missing bit means undefined, not a default', () => {
    // Wichtig fuer den Renderer-Dispatch: `style === undefined` ist nicht dasselbe wie 'bullet'.
    const decoded = roundTripStatic({ id: 7, ownerId: 'p1' });
    expect(decoded).toEqual({ id: 7, ownerId: 'p1' });
    expect(decoded.style).toBeUndefined();
    expect(decoded.color).toBeUndefined();
    expect(decoded.allowTeamDamage).toBeUndefined();
    expect(decoded.suppressSpawnFx).toBeUndefined();
    expect(decoded.tracer).toBeUndefined();
  });

  it('leaves optional tracer fields undefined instead of defaulting them to zero', () => {
    const decoded = roundTripStatic({
      id: 8,
      ownerId: 'p1',
      tracer: { widthCore: 2, widthGlow: 5, alphaCore: 0.9, alphaGlow: 0.35, segments: 8, fadeMs: 120 },
    });
    expect(decoded.tracer?.maxLength).toBeUndefined();
    expect(decoded.tracer?.colorCore).toBeUndefined();
    expect(decoded.tracer?.colorGlow).toBeUndefined();
    expect(decoded.tracer?.segments).toBe(8);
  });

  it('quantises tracer alphas without loss for authored two-decimal values', () => {
    for (const [alphaCore, alphaGlow] of [[0.05, 0.22], [0.96, 0.5], [1, 0]] as const) {
      const decoded = roundTripStatic({
        id: 9,
        ownerId: 'p1',
        tracer: { widthCore: 1, widthGlow: 2, alphaCore, alphaGlow, segments: 4, fadeMs: 90 },
      });
      expect(decoded.tracer?.alphaCore).toBeCloseTo(alphaCore, 10);
      expect(decoded.tracer?.alphaGlow).toBeCloseTo(alphaGlow, 10);
    }
  });

  it('transmits the muzzle origin unrounded so the flash does not shift', () => {
    const decoded = roundTripStatic({
      id: 10,
      ownerId: 'p1',
      visualMuzzleOrigin: { x: 1230.4375, y: -570.8125 },
    });
    expect(decoded.visualMuzzleOrigin).toEqual({ x: 1230.4375, y: -570.8125 });
  });

  it('round-trips every projectile style through its stable index', () => {
    // Der Schnappschuss der Laenge macht ein Umsortieren der Liste sichtbar - Indizes sind Wire-Werte.
    expect(PROJECTILE_STYLES).toHaveLength(16);
    for (const style of PROJECTILE_STYLES) {
      expect(roundTripStatic({ id: 1, ownerId: 'p1', style }).style).toBe(style);
    }
  });

  it('segments consecutive entries with different masks, including the variable tracer block', () => {
    const entries: SyncedProjectileStatic[] = [
      { id: 1, ownerId: 'p1', style: 'bullet' },
      {
        id: 2,
        ownerId: 'p2',
        tracer: { widthCore: 1, widthGlow: 3, alphaCore: 0.4, alphaGlow: 0.1, segments: 6, fadeMs: 200, colorGlow: 0x00ff00 },
      },
      { id: 3, ownerId: 'p3', color: 0x123456, suppressSpawnFx: true },
    ];
    const stream: Array<number | string> = [];
    for (const entry of entries) encodeProjectileStatic(stream, entry);
    expect(decodeProjectileStatics(stream)).toEqual(entries);
  });
});

describe('Projektil-Dynamik-Codec', () => {
  const base: SyncedProjectileDynamic = { id: 42, x: 1234, y: 567, vx: 800, vy: -300, size: 6 };

  it('round-trips the always-present movement fields with an empty mask', () => {
    const decoded = roundTripDynamic(base);
    expect(decoded).toEqual(base);
    expect(decoded.burning).toBeUndefined();
    expect(decoded.projectileBurnVisualStyle).toBeUndefined();
    expect(decoded.miniRocketPhase).toBeUndefined();
    expect(decoded.miniRocketCascadeStage).toBeUndefined();
  });

  it('round-trips every burning / burn-style combination', () => {
    for (const burning of [undefined, true] as const) {
      for (const style of [undefined, 'normal', 'void'] as const) {
        const decoded = roundTripDynamic({ ...base, burning, projectileBurnVisualStyle: style });
        expect(decoded.burning).toBe(burning);
        expect(decoded.projectileBurnVisualStyle).toBe(style);
      }
    }
  });

  it('distinguishes an absent mini-rocket cascade stage from stage zero', () => {
    const withoutStage = roundTripDynamic({ ...base, miniRocketPhase: 'coast' });
    expect(withoutStage.miniRocketPhase).toBe('coast');
    expect(withoutStage.miniRocketCascadeStage).toBeUndefined();

    const withStage = roundTripDynamic({ ...base, miniRocketPhase: 'return', miniRocketCascadeStage: 0 });
    expect(withStage.miniRocketPhase).toBe('return');
    expect(withStage.miniRocketCascadeStage).toBe(0);
  });

  it('keeps a steady-state bullet tick tiny - the whole point of splitting static from dynamic', () => {
    // Regressionsschutz: rutscht ein statisches Feld (Farbe, Preset, Tracer, ownerId) zurueck in den
    // Dynamik-Strom, waechst dieser Wert sofort deutlich und der Bandbreitengewinn ist dahin.
    // Gemessen: ~26 Zeichen gegenueber ~374 des frueheren Vollobjekts je Tick und Projektil.
    const stream: Array<number | string> = [];
    encodeProjectileDynamic(stream, base);
    expect(JSON.stringify(stream).length).toBeLessThan(40);
  });

  it('counts stream entries without allocating, matching the decoder', () => {
    const stream: Array<number | string> = [];
    encodeProjectileDynamic(stream, base);
    encodeProjectileDynamic(stream, { ...base, id: 43, burning: true, projectileBurnVisualStyle: 'void' });
    encodeProjectileDynamic(stream, { ...base, id: 44, miniRocketPhase: 'attack', miniRocketCascadeStage: 2 });
    expect(countProjectileDynamics(stream)).toBe(3);
    expect(decodeProjectileDynamics(stream)).toHaveLength(3);
  });
});

describe('Projektil-Snapshot-Zusammenfuehrung', () => {
  const bulletStatic: SyncedProjectileStatic = {
    id: 1,
    ownerId: 'shooter',
    color: 0xffcc00,
    style: 'bullet',
    bulletVisualPreset: 'ak47',
    shotAudioKey: 'ak47',
  };
  const bulletDynamic: SyncedProjectileDynamic = { id: 1, x: 100, y: 200, vx: 800, vy: 0, size: 6 };

  function snapshot(
    statics: SyncedProjectileStatic[],
    dynamics: SyncedProjectileDynamic[],
    full = false,
  ): SyncedProjectileSnapshot {
    const s: Array<number | string> = [];
    const u: Array<number | string> = [];
    for (const entry of statics) encodeProjectileStatic(s, entry);
    for (const entry of dynamics) encodeProjectileDynamic(u, entry);
    return full ? { s, u, f: 1 } : { s, u };
  }

  it('joins static and dynamic into a complete projectile', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    const [projectile] = applyProjectileSnapshot(cache, snapshot([bulletStatic], [bulletDynamic]));
    expect(projectile).toMatchObject({
      id: 1,
      ownerId: 'shooter',
      x: 100,
      y: 200,
      vx: 800,
      size: 6,
      color: 0xffcc00,
      style: 'bullet',
      bulletVisualPreset: 'ak47',
      shotAudioKey: 'ak47',
    });
  });

  it('drops a dynamic entry whose static has not arrived yet', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    expect(applyProjectileSnapshot(cache, snapshot([], [bulletDynamic]))).toEqual([]);
  });

  it('resolves a full snapshot from an empty cache - the late-joiner contract', () => {
    // Bei f === 1 muss `s` jede ID in `u` abdecken, sonst haengt der Latejoiner an Host-Cachezustaenden.
    const cache = new Map<number, SyncedProjectileStatic>();
    const rocketStatic: SyncedProjectileStatic = { id: 2, ownerId: 'shooter', style: 'rocket', color: 0xff0000 };
    const rocketDynamic: SyncedProjectileDynamic = { id: 2, x: 5, y: 6, vx: 1, vy: 2, size: 12 };
    const result = applyProjectileSnapshot(
      cache,
      snapshot([bulletStatic, rocketStatic], [bulletDynamic, rocketDynamic], true),
    );
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.style)).toEqual(['bullet', 'rocket']);
  });

  it('keeps cached statics when a later snapshot carries dynamics only', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    applyProjectileSnapshot(cache, snapshot([bulletStatic], [bulletDynamic]));
    const [projectile] = applyProjectileSnapshot(
      cache,
      snapshot([], [{ ...bulletDynamic, x: 140, vy: -20 }]),
    );
    expect(projectile.style).toBe('bullet');
    expect(projectile.bulletVisualPreset).toBe('ak47');
    expect(projectile.x).toBe(140);
    expect(projectile.vy).toBe(-20);
  });

  it('despawns via absence from the dynamic stream and releases the cached static', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    applyProjectileSnapshot(cache, snapshot([bulletStatic], [bulletDynamic]));
    expect(cache.size).toBe(1);
    expect(applyProjectileSnapshot(cache, snapshot([], []))).toEqual([]);
    expect(cache.size).toBe(0);
  });

  it('clears the cache on a full marker but not on a plain static refresh', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    applyProjectileSnapshot(cache, snapshot([bulletStatic], [bulletDynamic]));

    // Rollierender Refresh: zusaetzliche Statik ohne `f` - der Cache bleibt bestehen.
    const refreshed = applyProjectileSnapshot(cache, snapshot([bulletStatic], [bulletDynamic]));
    expect(refreshed).toHaveLength(1);

    // Full-Snapshot ohne Eintraege: der Cache wird verworfen.
    expect(applyProjectileSnapshot(cache, EMPTY_FULL_PROJECTILE_SNAPSHOT)).toEqual([]);
    expect(cache.size).toBe(0);
  });

  it('treats an absent slice as an empty arena, matching the pre-codec raw.j fallback', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    applyProjectileSnapshot(cache, snapshot([bulletStatic], [bulletDynamic]));
    expect(applyProjectileSnapshot(cache, undefined)).toEqual([]);
    expect(cache.size).toBe(0);
  });

  it('is idempotent - applying the same snapshot twice yields the same result', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    const wire = snapshot([bulletStatic], [bulletDynamic]);
    const first = applyProjectileSnapshot(cache, wire);
    const second = applyProjectileSnapshot(cache, wire);
    expect(second).toEqual(first);
  });

  it('carries hydra split children and the vanished parent within one snapshot', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    const parent: SyncedProjectileStatic = { id: 50, ownerId: 'shooter', style: 'hydra', color: 0x00ff00 };
    applyProjectileSnapshot(
      cache,
      snapshot([parent], [{ id: 50, x: 300, y: 300, vx: 200, vy: 0, size: 10 }]),
    );

    const children: SyncedProjectileStatic[] = [
      { id: 51, ownerId: 'shooter', style: 'hydra', color: 0x00ff00, suppressSpawnFx: true },
      { id: 52, ownerId: 'shooter', style: 'hydra', color: 0x00ff00, suppressSpawnFx: true },
    ];
    const result = applyProjectileSnapshot(
      cache,
      snapshot(children, [
        { id: 51, x: 302, y: 296, vx: 150, vy: -150, size: 8 },
        { id: 52, x: 302, y: 304, vx: 150, vy: 150, size: 8 },
      ]),
    );
    expect(result.map((p) => p.id)).toEqual([51, 52]);
    expect(result.every((p) => p.suppressSpawnFx === true)).toBe(true);
    expect(cache.has(50)).toBe(false);
  });

  it('preserves the stream order so spawn order stays intact', () => {
    const cache = new Map<number, SyncedProjectileStatic>();
    const statics = [3, 1, 2].map((id) => ({ id, ownerId: 'p', style: 'bullet' } as SyncedProjectileStatic));
    const dynamics = [3, 1, 2].map((id) => ({ id, x: id, y: id, vx: 0, vy: 0, size: 4 }));
    const result = applyProjectileSnapshot(cache, snapshot(statics, dynamics));
    expect(result.map((p) => p.id)).toEqual([3, 1, 2]);
  });
});
