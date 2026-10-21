import { describe, expect, it } from 'vitest';
import rawCatalog from '../src/config/reactiveProps/reactivePropKinds.json';
import {
  parseReactivePropCatalog,
  reactivePropEffectLifetimeMs,
  REACTIVE_PROP_KINDS,
} from '../src/config/reactiveProps/reactivePropKinds';

type Json = Record<string, unknown>;
const clone = (): Json => JSON.parse(JSON.stringify(rawCatalog)) as Json;
const kind = (catalog: Json, id: string): Json => (catalog.kinds as Json)[id] as Json;

describe('reactive prop kind catalog', () => {
  it('parses every authored kind; recharging kinds cover their whole effect lifetime', () => {
    expect(() => parseReactivePropCatalog(rawCatalog)).not.toThrow();
    for (const parsed of REACTIVE_PROP_KINDS.values()) {
      if (parsed.afterEffect.kind !== 'recharge' || parsed.effect.kind === 'explosion') continue;
      expect(parsed.afterEffect.rechargeMs).toBeGreaterThanOrEqual(reactivePropEffectLifetimeMs(parsed.effect));
    }
  });

  it('rejects a recharge shorter than the effect, so one prop never has two effects out', () => {
    for (const id of ['spore_puffball', 'bee_hive']) {
      const catalog = clone();
      (kind(catalog, id).afterEffect as Json).rechargeMs = 1000;
      expect(() => parseReactivePropCatalog(catalog)).toThrow(/rechargeMs/);
    }
  });

  it('rejects mixed families and mismatched presentations', () => {
    const burnPuffball = clone();
    kind(burnPuffball, 'spore_puffball').priming = { kind: 'burn', selfDamagePerSecond: 15 };
    expect(() => parseReactivePropCatalog(burnPuffball)).toThrow();

    const recharginBarrel = clone();
    kind(recharginBarrel, 'explosive_barrel').afterEffect = { kind: 'recharge', rechargeMs: 15000 };
    expect(() => parseReactivePropCatalog(recharginBarrel)).toThrow();

    const hiveAsPuffball = clone();
    (kind(hiveAsPuffball, 'bee_hive').visual as Json).presentation = 'puffball';
    expect(() => parseReactivePropCatalog(hiveAsPuffball)).toThrow(/presentation/);
  });

  it('rejects a slow that would flicker between cloud ticks', () => {
    const catalog = clone();
    const effect = kind(catalog, 'spore_puffball').effect as Json;
    effect.slowDurationMs = (effect.tickIntervalMs as number) - 1;
    expect(() => parseReactivePropCatalog(catalog)).toThrow(/slowDurationMs/);
  });

  it('keeps recharging kinds out of PvP arena scatter', () => {
    const catalog = clone();
    (catalog.arenaScatter as Json).deathmatch = [{ kind: 'bee_hive', clusters: 2, clusterSize: [1, 1], minSpacingCells: 9 }];
    expect(() => parseReactivePropCatalog(catalog)).toThrow(/arenaScatter/);
  });
});
